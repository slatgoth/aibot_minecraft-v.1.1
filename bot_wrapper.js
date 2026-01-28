const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const pvp = require('mineflayer-pvp').plugin
const armorManager = require('mineflayer-armor-manager')
const autoEat = require('mineflayer-auto-eat').plugin
const collectBlock = require('mineflayer-collectblock').plugin
const toolPlugin = require('mineflayer-tool').plugin

// Get config from args
const args = JSON.parse(process.argv[2])

const bot = mineflayer.createBot({
  host: args.host,
  port: args.port,
  username: args.username,
  version: args.version,
  auth: 'offline'
})

// Load Plugins
bot.loadPlugin(pathfinder)
bot.loadPlugin(pvp)
bot.loadPlugin(armorManager)
bot.loadPlugin(autoEat)
bot.loadPlugin(collectBlock)
bot.loadPlugin(toolPlugin)

// Flags
let ignorePickup = false
let inventoryBusy = false

function waitForCondition(checkFn, timeoutMs, intervalMs) {
    return new Promise((resolve, reject) => {
        const start = Date.now()
        const timer = setInterval(() => {
            let ok = false
            try { ok = checkFn() } catch (e) {}
            if (ok) {
                clearInterval(timer)
                resolve(true)
                return
            }
            if (Date.now() - start > timeoutMs) {
                clearInterval(timer)
                reject(new Error('timeout'))
            }
        }, intervalMs)
    })
}

async function approachTarget(targetName, range, timeoutMs) {
    const target = bot.players[targetName]?.entity
    if (!target) throw new Error('target_not_visible')
    bot.pathfinder.setGoal(new goals.GoalFollow(target, range), true)
    try {
        await waitForCondition(() => {
            const t = bot.players[targetName]?.entity
            if (!t || !bot.entity) return false
            return t.position.distanceTo(bot.entity.position) <= range
        }, timeoutMs, 250)
    } finally {
        bot.pathfinder.setGoal(null)
    }
}

async function withInventoryLock(fn) {
    if (inventoryBusy) return
    inventoryBusy = true
    try {
        await fn()
    } finally {
        inventoryBusy = false
    }
}

bot.on('spawn', () => {
  process.send({ type: 'log', text: 'Bot spawned successfully!', logType: 'info' })
  const mcData = require('minecraft-data')(bot.version)
  const defaultMove = new Movements(bot, mcData)
  defaultMove.canDig = true
  defaultMove.allow1by1towers = true
  bot.pathfinder.setMovements(defaultMove)
})

bot.on('chat', (username, message) => {
  if (username === bot.username) return
  const items = bot.inventory.items().map(i => `${i.name} x${i.count}`).join(', ') || '(empty)'
  process.send({ 
      type: 'chat_event', 
      username, 
      message,
      inventory: items,
      position: bot.entity.position 
  })
  process.send({ type: 'log', text: `[Chat] ${username}: ${message}`, logType: 'chat' })
})

bot.on('entityHurt', (entity) => {
    if (entity !== bot.entity) return
    const attacker = bot.nearestEntity(e => e.type === 'player' && e.position.distanceTo(bot.entity.position) < 5)
    if (attacker) {
        process.send({ type: 'chat_event', username: 'SYSTEM', message: `WARNING: You were ATTACKED by player ${attacker.username}!` })
        process.send({ type: 'log', text: `[Event] Attacked by ${attacker.username}`, logType: 'error' })
    }
})

bot.on('playerCollect', (collector, collected) => {
    if (collector !== bot.entity) return
    
    // 1. Guess Source (Nearest player within 5 blocks)
    const source = bot.nearestEntity(e => e.type === 'player' && e.position.distanceTo(bot.entity.position) < 5)
    const fromStr = source ? ` (likely from ${source.username})` : ''

    // 2. Snapshot Inventory
    const oldInv = bot.inventory.items().map(i => ({ name: i.name, count: i.count, display: i.displayName }))
    
    // 3. Wait for packet sync & Find diff
    setTimeout(() => {
        const newInv = bot.inventory.items()
        
        const added = newInv.find(n => {
            const old = oldInv.find(o => o.name === n.name)
            return !old || n.count > old.count
        })
        
        if (added) {
            const oldVal = oldInv.find(o => o.name === added.name)?.count || 0
            const diff = added.count - oldVal
            const itemName = added.displayName || added.name
            
            process.send({ 
                type: 'chat_event', 
                username: 'SYSTEM', 
                message: `EVENT: You picked up ${itemName} x${diff}${fromStr}` 
            })
        } else {
            // Fallback if inventory didn't update yet or full
            process.send({ 
                type: 'chat_event', 
                username: 'SYSTEM', 
                message: `EVENT: You picked up an item${fromStr}` 
            })
        }
    }, 150)
})

bot.on('kicked', (reason) => process.send({ type: 'log', text: `Kicked: ${reason}`, logType: 'error' }))
bot.on('error', (err) => process.send({ type: 'log', text: `Error: ${err.message}`, logType: 'error' }))

// IPC Commands
process.on('message', async (msg) => {
  if (msg.type === 'speak') bot.chat(msg.text)
  
  else if (msg.type === 'command') bot.chat(msg.text)
  
  else if (msg.type === 'get_inventory') {
      const simplified = bot.inventory.slots.map((item, index) => {
          if(!item) return null
          return { slot: index, name: item.name, count: item.count, displayName: item.displayName }
      })
      process.send({ type: 'inventory_data', data: simplified })
  }
  
  else if (msg.type === 'move_item') {
      const from = Number(msg.from)
      const to = Number(msg.to)
      if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return
      try {
          await withInventoryLock(async () => {
              await bot.clickWindow(from, 0, 0)
              await bot.clickWindow(to, 0, 0)
          })
      } catch (e) {
          process.send({ type: 'log', text: `Inventory move error: ${e.message}`, logType: 'error' })
      }
  }

  else if (msg.type === 'drop_item') {
      const slot = Number(msg.slot)
      const count = Number(msg.count)
      if (!Number.isInteger(slot)) return
      const item = bot.inventory.slots[slot]
      if (!item) return
      try {
          await withInventoryLock(async () => {
              if (Number.isInteger(count) && count > 0 && count < item.count) {
                  await bot.toss(item.type, null, count)
              } else {
                  await bot.tossStack(item)
              }
          })
      } catch (e) {
          process.send({ type: 'log', text: `Inventory drop error: ${e.message}`, logType: 'error' })
      }
  }

  else if (msg.type === 'manual_control') {
      const { action, state } = msg
      process.send({ type: 'log', text: `🕹️ MANUAL: ${action.toUpperCase()} ${state ? 'ON' : 'OFF'}`, logType: 'action' })
      
      if (state === true) bot.pathfinder.setGoal(null)
      if (['forward', 'back', 'left', 'right', 'jump', 'sprint'].includes(action)) bot.setControlState(action, state)
      else if (action === 'attack' && state === true) {
          const entity = bot.nearestEntity(e => e.type === 'mob' || e.type === 'player')
          if (entity) { bot.lookAt(entity.position.offset(0, entity.height, 0)); bot.attack(entity) }
          else bot.swingArm()
      }
      else if (action === 'stop') { bot.clearControlStates(); bot.pathfinder.setGoal(null); bot.pvp.stop() }
  }
  
  else if (msg.type === 'ai_action') {
      const { action, params } = msg
      try {
        const cmd = action.toLowerCase()
        if (cmd === 'stop') { 
            process.send({ type: 'log', text: `🛑 STOPPING ALL ACTIONS`, logType: 'action' })
            bot.pathfinder.setGoal(null); bot.pvp.stop(); bot.clearControlStates() 
        }
        else if (cmd === 'follow' || cmd === 'move_to_player') {
            const target = bot.players[params.target]?.entity
            if (target) {
                process.send({ type: 'log', text: `🏃 FOLLOWING ${params.target}`, logType: 'action' })
                bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true)
            }
        }
        else if (cmd === 'goto' || cmd === 'move_to' || cmd === 'run') {
            process.send({ type: 'log', text: `🚶 MOVING TO [${params.x}, ${params.y}, ${params.z}]`, logType: 'action' })
            bot.pathfinder.setGoal(new goals.GoalNear(params.x, params.y, params.z, 1))
        }
        else if (cmd === 'attack' || cmd === 'fight') {
            const target = (params && params.target) ? bot.players[params.target]?.entity : bot.nearestEntity(e => e.type === 'mob' || e.type === 'player')
            if (target) bot.pvp.attack(target)
        }
        else if (cmd === 'lookat' || cmd === 'look_at') {
            const target = bot.players[params.target]?.entity || bot.nearestEntity(e => e.type === 'player')
            if (target) {
                process.send({ type: 'log', text: `👀 LOOKING AT ${params.target || 'entity'}`, logType: 'action' })
                bot.lookAt(target.position.offset(0, target.height, 0))
            }
        }
        else if (cmd === 'equip' || cmd === 'hold') {
            if (!params || !params.item) return
            const search = String(params.item).toLowerCase().replace(/_/g, ' ')
            const item = bot.inventory.items().find(i => i.name.toLowerCase().replace(/_/g, ' ').includes(search) || i.displayName.toLowerCase().includes(search))
            if (item) {
                await bot.equip(item, 'hand')
                process.send({ type: 'log', text: `Equipped ${item.name}`, logType: 'info' })
            }
        }
        else if (cmd === 'drop' || cmd === 'give' || cmd === 'toss') {
            if (!params || !params.item) return
            const search = String(params.item).toLowerCase().replace(/_/g, ' ')
            const item = bot.inventory.items().find(i => i.name.toLowerCase().replace(/_/g, ' ').includes(search) || i.displayName.toLowerCase().includes(search))
            if (item) {
                const targetName = params.target ? String(params.target) : ''
                const count = Number(params.count)
                ignorePickup = true
                try {
                    if (targetName) {
                        process.send({ type: 'log', text: `🎁 MOVING TO ${targetName} TO DROP ITEM`, logType: 'action' })
                        await approachTarget(targetName, 2.2, 12000)
                    }
                    await bot.look(bot.entity.yaw, 0)
                    await bot.equip(item, 'hand')
                    if (Number.isInteger(count) && count > 0 && count < item.count) {
                        await bot.toss(item.type, null, count)
                    } else {
                        await bot.tossStack(item)
                    }
                } catch (e) {
                    process.send({ type: 'log', text: `Drop error: ${e.message}`, logType: 'error' })
                } finally {
                    setTimeout(() => { ignorePickup = false }, 3000)
                }
            }
        }
      } catch (e) { process.send({ type: 'log', text: `AI Action Error: ${e.message}`, logType: 'error' }) }
  }
})

// Auto-Pickup Loop
setInterval(() => {
    if (bot.pathfinder.isMoving() || ignorePickup) return
    const drop = bot.nearestEntity(e => (e.name === 'item' || e.type === 'object') && e.position.distanceTo(bot.entity.position) < 4)
    if (drop) bot.pathfinder.setGoal(new goals.GoalFollow(drop, 0), true)
}, 1000)

// --- SENSORY SYSTEM (The Eyes) ---
setInterval(() => {
    if (!bot.entity) return

    // 1. Where am I?
    const block = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    const floor = block ? block.name : 'air'
    const time = bot.time.timeOfDay < 13000 ? 'Day' : 'Night'
    
    // 2. Who is near? (Grouped)
    const entities = {}
    const nearby = bot.nearestEntity(e => {
        if (e === bot.entity) return false
        if (e.type === 'object' || e.type === 'mob' || e.type === 'player') {
            return e.position.distanceTo(bot.entity.position) < 15
        }
        return false
    })
    
    // Scan all entities manually since nearestEntity returns only one
    // We need a manual loop for full scan
    for (const id in bot.entities) {
        const e = bot.entities[id]
        if (e === bot.entity) continue
        if (e.position.distanceTo(bot.entity.position) > 15) continue
        
        let name = e.username || e.displayName || e.name || 'unknown'
        if (e.name === 'item' || e.type === 'object') {
            // Try to resolve item name
            name = 'Item' // generic if metadata parsing fails, but good enough
        }
        
        if (!entities[name]) entities[name] = 0
        entities[name]++
    }
    
    const entityList = Object.entries(entities).map(([k, v]) => `${k} x${v}`).join(', ') || 'None'

    // 3. Send to Brain
    process.send({ 
        type: 'env_update', 
        data: { floor, time, nearby: entityList } 
    })
}, 4000)
