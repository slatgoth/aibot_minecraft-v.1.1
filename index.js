const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const armorManager = require('mineflayer-armor-manager')
const autoEat = require('mineflayer-auto-eat').plugin
const collectBlock = require('mineflayer-collectblock').plugin
const toolPlugin = require('mineflayer-tool').plugin
const Vec3 = require('vec3')

// --- Configuration ---
const botOptions = {
  host: 'localhost',
  port: 25568,       
  username: 'Bot_AI',
  version: '1.21.4',
  auth: 'offline'
}

console.log(`ЗАПУСК ИСКУССТВЕННОГО ИНТЕЛЛЕКТА...`)
const bot = mineflayer.createBot(botOptions)

// --- Global State ---
let mcData = null
let masterName = null
let autoMode = false // Freedom mode
let busy = false // If executing a complex task
let guardPos = null

// --- Load Plugins ---
bot.loadPlugin(pathfinder)
bot.loadPlugin(pvp)
bot.loadPlugin(armorManager)
bot.loadPlugin(autoEat)
bot.loadPlugin(collectBlock)
bot.loadPlugin(toolPlugin)

// --- Events ---

bot.on('spawn', () => {
  console.log('Системы активны. Жду приказов или включения авто-режима.')
  mcData = require('minecraft-data')(bot.version)
  
  const defaultMove = new Movements(bot, mcData)
  defaultMove.canDig = true 
  defaultMove.allow1by1towers = true 
  defaultMove.allowParkour = true 
  defaultMove.scafoldingBlocks = [mcData.blocksByName.dirt.id, mcData.blocksByName.cobblestone.id, mcData.blocksByName.netherrack.id]
  bot.pathfinder.setMovements(defaultMove)
  
  bot.autoEat.options = { priority: 'foodPoints', startAt: 16, bannedFood: ['rotten_flesh', 'spider_eye'] }
  
  // Start the Brain Loop
  setInterval(brainTick, 5000)
  // Ambient chat loop
  setInterval(ambientChat, 30000)
})

// --- THE BRAIN (DECISION ENGINE) ---
async function brainTick() {
    if (!autoMode || busy || bot.pvp.target || bot.pathfinder.isMoving()) return

    // 1. SURVIVAL: NIGHT CHECK
    if (!bot.time.isDay && bot.time.day > 13000) {
        // Find bed or safe spot
        const bed = bot.findBlock({ matching: block => bot.isABed(block), maxDistance: 32 })
        if (bed) {
            busy = true
            bot.chat("Ночь. Иду спать.")
            try { await bot.sleep(bed) } catch(e) {}
            busy = false
            return
        }
    }

    // 2. RESOURCE MANAGEMENT: FULL INVENTORY
    const itemsCount = bot.inventory.items().length
    if (itemsCount > 30) { // Almost full
        const chest = bot.findBlock({ matching: mcData.blocksByName.chest.id, maxDistance: 32 })
        if (chest) {
            busy = true
            bot.chat("Рюкзак полон. Скидываю лут.")
            await dumpLoot(chest)
            busy = false
            return
        }
    }

    // 3. HUNGER: GATHER FOOD
    const food = bot.inventory.items().find(i => i.foodPoints > 0)
    if (!food && bot.food < 15) {
        busy = true
        bot.chat("Хочу есть. Ищу еду...")
        await findFood()
        busy = false
        return
    }

    // 4. BOREDOM: GATHER WOOD OR FOLLOW MASTER
    if (masterName) {
        const target = bot.players[masterName]?.entity
        if (target && bot.entity.position.distanceTo(target.position) > 5) {
            bot.pathfinder.setGoal(new goals.GoalFollow(target, 3), true)
        }
    } else {
        // Wander or Chop
        if (Math.random() < 0.3) {
            const tree = bot.findBlock({ matching: b => b.name.includes('log'), maxDistance: 20 })
            if (tree) {
                busy = true
                bot.chat("Срублю дерево, пока делать нечего.")
                await bot.collectBlock.collect(tree)
                busy = false
            }
        }
    }
}

// --- AMBIENT CHAT ---
function ambientChat() {
    if (!autoMode) return
    if (bot.time.isRaining && Math.random() < 0.3) bot.chat("Опять дождь... Ржавею.")
    if (bot.health < 10 && Math.random() < 0.5) bot.chat("Мне нужен врач.")
    if (Math.random() < 0.1) bot.chat("Скучно. Есть миссии?")
}

// --- COMPLEX ACTIONS ---

async function dumpLoot(chestBlock) {
    try {
        await bot.pathfinder.goto(new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2))
        const chest = await bot.openChest(chestBlock)
        for (const item of bot.inventory.items()) {
            if (item.name.includes('sword') || item.name.includes('pickaxe') || item.name.includes('helmet') || item.name.includes('chestplate') || item.name.includes('bow')) continue
            await chest.deposit(item.type, null, item.count)
        }
        chest.close()
    } catch (e) { console.log(e) }
}

async function findFood() {
    // Try crops first
    const crop = bot.findBlock({ matching: b => (b.name === 'wheat' || b.name === 'carrots') && b.metadata === 7, maxDistance: 32 })
    if (crop) {
        await bot.collectBlock.collect(crop)
        return
    }
    // Try mobs (pigs/cows)
    const animal = bot.nearestEntity(e => (e.name === 'pig' || e.name === 'cow' || e.name === 'chicken') && e.position.distanceTo(bot.entity.position) < 20)
    if (animal) {
        bot.pvp.attack(animal)
    }
}

// --- PRO COMBAT LOGIC ---
bot.on('physicsTick', async () => {
    // MLG Safety
    if (bot.entity.velocity.y < -0.6 && !bot.entity.isInWater) {
        const bucket = bot.inventory.items().find(i => i.name === 'water_bucket')
        if (bucket) { await bot.equip(bucket, 'hand'); bot.activateItem() }
    }

    // Auto-Totem
    if (bot.health < 8) {
        const totem = bot.inventory.items().find(i => i.name === 'totem_of_undying')
        if (totem && !bot.inventory.slots[45]) bot.equip(totem, 'off-hand')
    }

    // TARGET PRIORITIZATION
    if (autoMode || guardPos) {
        // Find best target
        const mobs = Object.values(bot.entities).filter(e => e.type === 'mob' && e.position.distanceTo(bot.entity.position) < 10 && e.kind !== 'Passive')
        
        if (mobs.length > 0) {
            // Sort: Creeper > Skeleton > Others
            mobs.sort((a, b) => {
                const scoreA = (a.name === 'creeper' ? 10 : (a.name === 'skeleton' ? 5 : 1))
                const scoreB = (b.name === 'creeper' ? 10 : (b.name === 'skeleton' ? 5 : 1))
                return scoreB - scoreA
            })
            
            const target = mobs[0]
            if (target && bot.pvp.target !== target) {
                bot.pvp.attack(target)
            }
        }
    }
})

// --- COMMANDS ---
bot.on('chat', async (username, message) => {
  if (username === bot.username) return
  const msg = message.toLowerCase()
  const args = msg.split(' ')
  const command = args[0]

  try {
    // --- MAIN CONTROLS ---
    if (command === 'авто') {
        autoMode = !autoMode
        bot.chat(autoMode ? "Авто-режим ВКЛЮЧЕН. Я теперь сам по себе." : "Авто-режим ВЫКЛЮЧЕН. Жду приказов.")
        if (!autoMode) {
            bot.pathfinder.setGoal(null)
            bot.pvp.stop()
        }
    }

    else if (command === 'телохранитель') {
        masterName = username
        bot.chat(`Принято. Охраняю ${username}.`)
    }
    
    // --- UTILITIES (Manual Overrides) ---
    else if (command === 'алмазы') {
        bot.chat("Включаю сканер...")
        const ore = bot.findBlock({ matching: [mcData.blocksByName.diamond_ore.id, mcData.blocksByName.deepslate_diamond_ore.id], maxDistance: 64 })
        if(ore) { bot.chat(`Нашел! ${ore.position}.`); await bot.collectBlock.collect(ore) } else bot.chat("Пусто.")
    }
    else if (command === 'дом') {
        // Quick house builder
        bot.chat("Строю базу.")
        const mat = bot.inventory.items().find(i => i.name === 'cobblestone' || i.name === 'oak_planks')
        if(mat) {
             await bot.equip(mat, 'hand')
             // Simple 4x4 logic
             const base = bot.entity.position.floored().offset(2,0,0)
             for(let y=0; y<3; y++) {
                 for(let x=0; x<4; x++) for(let z=0; z<4; z++) {
                     if(x===0||x===3||z===0||z===3) {
                         if(x===1&&z===0&&y<2) continue // door
                         const p = base.offset(x,y,z)
                         if(bot.blockAt(p).name==='air') await bot.placeBlock(bot.blockAt(p.offset(0,-1,0)), new Vec3(0,1,0)).catch(()=>{})
                     }
                 }
             }
        }
    }
    
    else if (command === 'ко мне') { masterName = null; const t = bot.players[username]?.entity; if(t) bot.pathfinder.setGoal(new goals.GoalNear(t.position.x, t.position.y, t.position.z, 2)) }
    else if (command === 'стоп') { autoMode = false; busy = false; bot.pathfinder.setGoal(null); bot.pvp.stop(); bot.chat("Стоп.") }

  } catch (err) {
    bot.chat("Error: " + err.message)
  }
})

bot.on('kicked', console.log)
bot.on('error', console.log)
