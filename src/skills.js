const { goals } = require('mineflayer-pathfinder');
const { logger } = require('./utils');
const config = require('./config');
const Vec3 = require('vec3');

const memory = require('./memory_store');

class Skills {
    constructor(bot) {
        this.bot = bot;
        this.lastWanderAt = 0;
        this.lastWanderTarget = null;
        this.followHistory = new Map();
    }

    async remember_fact(args = {}) {
        const { player_name, fact } = args;
        if (!player_name || !fact) {
            this.bot.chat('не понял что запоминать');
            return;
        }
        memory.addFact(player_name, fact);
        this.bot.chat(`запомнил про ${player_name}: ${fact}`);
        logger.info(`Memory saved: ${player_name} -> ${fact}`);
    }

    async say(args) {
        let text = args;
        if (typeof args === 'object' && args.text) {
            text = args.text;
        }
        this.bot.chat(String(text));
    }

    async whisper(args = {}) {
        const player = args.player || args.player_name;
        const text = args.text;
        if (!player || !text) return;
        this.bot.whisper(player, String(text));
    }

    async move_to(args = {}) {
        const x = Number(args.x);
        const y = Number(args.y);
        const z = Number(args.z);
        if (![x, y, z].every(Number.isFinite)) {
            this.bot.chat('координаты не понял');
            return;
        }
        const goal = new goals.GoalBlock(x, y, z);
        this.bot.pathfinder.setGoal(goal);
    }

    async look_at(args = {}) {
        const x = Number(args.x);
        const y = Number(args.y);
        const z = Number(args.z);
        if (![x, y, z].every(Number.isFinite)) return;
        await this.bot.lookAt(new Vec3(x, y, z));
    }

    async place_block(args = {}) {
        const { name } = args;
        const x = Number(args.x);
        const y = Number(args.y);
        const z = Number(args.z);
        const hasTarget = [x, y, z].every(Number.isFinite);
        if (!name) {
            this.bot.chat('не понял что или куда ставить');
            return;
        }
        const item = this.bot.inventory.items().find(i => i.name === name);
        
        if (!item) {
            this.bot.chat(`нету ${name} для стройки`);
            return;
        }

        const tryPlaceAt = async (targetPos) => {
            const targetBlock = this.bot.blockAt(targetPos);
            if (!targetBlock) return false;
            const isAir = targetBlock.type === 0 || targetBlock.name.endsWith('air');
            if (!isAir) return false;

            const offsets = [
                new Vec3(0, -1, 0),
                new Vec3(0, 1, 0),
                new Vec3(1, 0, 0),
                new Vec3(-1, 0, 0),
                new Vec3(0, 0, 1),
                new Vec3(0, 0, -1)
            ];

            for (const offset of offsets) {
                const refPos = targetPos.plus(offset);
                const referenceBlock = this.bot.blockAt(refPos);
                if (!referenceBlock) continue;
                if (referenceBlock.boundingBox === 'empty') continue;

                const faceVector = targetPos.minus(refPos);
                const faceMagnitude = Math.abs(faceVector.x) + Math.abs(faceVector.y) + Math.abs(faceVector.z);
                if (faceMagnitude !== 1) continue;

                const dist = this.bot.entity.position.distanceTo(refPos);
                if (dist > 4.5) {
                    try {
                        await this.bot.pathfinder.goto(new goals.GoalNear(refPos.x, refPos.y, refPos.z, 2));
                    } catch (e) {
                        continue;
                    }
                }

                try {
                    await this.bot.equip(item, 'hand');
                    await this.bot.placeBlock(referenceBlock, faceVector);
                    return true;
                } catch (e) {
                    logger.error(`Place block failed`, e);
                }
            }
            return false;
        };

        let placed = false;
        if (hasTarget) {
            const targetPos = new Vec3(x, y, z);
            placed = await tryPlaceAt(targetPos);
        }

        if (!placed) {
            const solids = this.bot.findBlocks({
                matching: (block) => block.type !== 0,
                maxDistance: 4,
                count: 30
            });
            for (const pos of solids) {
                const topPos = pos.offset(0, 1, 0);
                if (await tryPlaceAt(topPos)) {
                    placed = true;
                    break;
                }
            }
        }

        if (!placed) {
            this.bot.chat('не нашел место для блока');
        }
    }

    async reply_to(args = {}) {
        const { player, text } = args;
        if (!player || !text) return;
        this.bot.chat(`${player}, ${text}`);
    }

    async check_inventory() {
        // No-op, inventory is in context
        logger.info("Checked inventory (internal)");
    }

    async scan_surroundings() {
        // No-op, perception is in context
        logger.info("Scanned surroundings (internal)");
    }

    async equip(args = {}) {
        const { item_name, slot } = args;
        if (!item_name) {
            this.bot.chat('что надеть?');
            return;
        }
        const item = this.bot.inventory.items().find(i => i.name === item_name);
        if (!item) {
            this.bot.chat(`нет у меня ${item_name}`);
            return;
        }
        try {
            // map specific slots if needed, otherwise default
            const destination = slot === 'off-hand' ? 'off-hand' : 'hand'; 
            await this.bot.equip(item, destination);
        } catch (e) {
            logger.error(`Equip failed`, e);
            this.bot.chat(`не надевается чет`);
        }
    }

    async sleep() {
        const bed = this.bot.findBlock({
            matching: block => this.bot.isABed(block),
            maxDistance: 32
        });
        if (!bed) {
            this.bot.chat("кровати нет рядом");
            return;
        }
        try {
            await this.bot.pathfinder.goto(new goals.GoalNear(bed.position.x, bed.position.y, bed.position.z, 1));
            await this.bot.sleep(bed);
            this.bot.chat("сплю... ззз");
        } catch (e) {
            this.bot.chat(`не спится: ${e.message}`);
        }
    }

    async wake() {
        try {
            await this.bot.wake();
        } catch (e) {
            // ignore
        }
    }

    async eat(args) {
        const { name } = args || {};
        const food = name 
            ? this.bot.inventory.items().find(i => i.name === name)
            : this.bot.inventory.items().find(i => i.food > 0);

        if (!food) {
            this.bot.chat("жрать нечего");
            return;
        }

        try {
            await this.bot.equip(food, 'hand');
            await this.bot.consume();
        } catch (e) {
            logger.error("Eat failed", e);
        }
    }

    async activate_block(args = {}) {
        const x = Number(args.x);
        const y = Number(args.y);
        const z = Number(args.z);
        if (![x, y, z].every(Number.isFinite)) return;
        const block = this.bot.blockAt(new Vec3(x, y, z));
        if (!block) return;
        
        try {
            await this.bot.pathfinder.goto(new goals.GoalNear(x, y, z, 2));
            await this.bot.lookAt(block.position);
            await this.bot.activateBlock(block);
        } catch (e) {
            logger.error("Activate failed", e);
        }
    }

    async use_chest(args = {}) {
        const { action, item_name } = args;
        const x = Number(args.x);
        const y = Number(args.y);
        const z = Number(args.z);
        const count = Number.isFinite(Number(args.count)) ? Number(args.count) : 1;
        if (!['deposit', 'withdraw'].includes(action)) return;
        if (!item_name || ![x, y, z].every(Number.isFinite)) return;
        // action: 'deposit' | 'withdraw'
        const chestBlock = this.bot.blockAt(new Vec3(x, y, z));
        if (!chestBlock) return;

        try {
            await this.bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1));
            const chest = await this.bot.openContainer(chestBlock);
            
            if (action === 'deposit') {
                const item = this.bot.inventory.items().find(i => i.name === item_name);
                if (item) await chest.deposit(item.type, null, count);
                else this.bot.chat(`нет у меня ${item_name} чтобы положить`);
            } else if (action === 'withdraw') {
                const item = chest.containerItems().find(i => i.name === item_name);
                if (item) await chest.withdraw(item.type, null, count);
                else this.bot.chat(`в сундуке нет ${item_name}`);
            }
            
            await new Promise(r => setTimeout(r, 500));
            chest.close();
        } catch (e) {
            logger.error("Chest op failed", e);
            this.bot.chat("сундук не открывается или запривачен");
        }
    }

    async mount(args = {}) {
        const { entity_type } = args; // e.g., 'boat', 'minecart', 'horse'
        if (!entity_type) return;
        const entity = this.bot.nearestEntity(e => e.name && e.name.toLowerCase().includes(entity_type));
        
        if (entity) {
            this.bot.mount(entity);
        } else {
            this.bot.chat(`не вижу ${entity_type}`);
        }
    }

    async dismount() {
        this.bot.dismount();
    }

    async wander(args = {}) {
        const rangeRaw = Number(args.range);
        const range = Number.isFinite(rangeRaw) ? Math.max(rangeRaw, 6) : 20;
        const bot = this.bot;

        const now = Date.now();
        if (bot.pathfinder.isMoving() && now - this.lastWanderAt < 8000) return;
        
        // Random angle and distance
        let targetX = bot.entity.position.x;
        let targetZ = bot.entity.position.z;
        let attempt = 0;
        while (attempt < 3) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 5 + Math.random() * (range - 5);
            targetX = bot.entity.position.x + Math.cos(angle) * dist;
            targetZ = bot.entity.position.z + Math.sin(angle) * dist;
            const candidate = new Vec3(targetX, bot.entity.position.y, targetZ);
            if (!this.lastWanderTarget || this.lastWanderTarget.distanceTo(candidate) > 3) {
                break;
            }
            attempt += 1;
        }
        
        // Use pathfinder to find a safe spot near there
        // GoalNear is flexible
        const goal = new goals.GoalNear(targetX, bot.entity.position.y, targetZ, 2);
        bot.pathfinder.setGoal(goal);
        
        // Optional: look where we are going
        bot.lookAt(new Vec3(targetX, bot.entity.position.y, targetZ));
        this.lastWanderAt = now;
        this.lastWanderTarget = new Vec3(targetX, bot.entity.position.y, targetZ);
    }

    async toss_all() {
        const items = this.bot.inventory.items();
        for (const item of items) {
            await this.bot.toss(item.type, null, item.count);
            await new Promise(r => setTimeout(r, 200));
        }
        this.bot.chat("я пустой теперь");
    }

    async follow(args = {}) {
        let targetName = args.targetName || args.entity_name || args.entity || args.name || args.player;
        
        let target = null;
        if (targetName && targetName.toLowerCase() !== 'player') {
             target = this.bot.players[targetName]?.entity;
        }
        
        // If specific target not found or generic request, find nearest player
        if (!target) {
            target = this.bot.nearestEntity(e => {
                if (e.type !== 'player') return false;
                const name = e.username || e.name;
                return !memory.isMuted(name);
            });
        }

        if (!target) {
            this.bot.chat("никого нет рядом чтобы идти");
            return;
        }

        const targetUsername = target.username || target.name || targetName;
        if (memory.isMuted(targetUsername)) {
            return;
        }
        
        let targetLabel = target.username || target.name || targetName || 'player';
        const now = Date.now();
        const windowMs = 15000;
        const entry = this.followHistory.get(targetLabel) || { count: 0, lastAt: 0 };
        if (now - entry.lastAt < windowMs) {
            entry.count += 1;
        } else {
            entry.count = 1;
        }
        entry.lastAt = now;
        this.followHistory.set(targetLabel, entry);

        if (entry.count >= 3) {
            const alt = this.bot.nearestEntity(e => {
                if (e.type !== 'player') return false;
                if (e === target) return false;
                const name = e.username || e.name;
                return !memory.isMuted(name);
            });
            if (alt) {
                target = alt;
                targetLabel = alt.username || alt.name || targetLabel;
                this.followHistory.set(targetLabel, { count: 1, lastAt: now });
            } else {
                return;
            }
        }

        const goal = new goals.GoalFollow(target, 2);
        this.bot.pathfinder.setGoal(goal, true);
    }

    stop() {
        this.bot.pathfinder.setGoal(null);
    }

    async mine_block(args = {}) {
        const { name } = args;
        const count = Number.isFinite(Number(args.count)) ? Number(args.count) : 1;
        if (!name) {
            this.bot.chat('что копать?');
            return false;
        }
        // Basic implementation - requires more complex logic for finding blocks
        const blocks = this.bot.findBlocks({
            matching: (block) => block.name === name,
            maxDistance: 32,
            count: count
        });

        if (blocks.length === 0) {
            this.bot.chat(`не вижу ${name} рядом`);
            return false;
        }

        for (const pos of blocks) {
            const block = this.bot.blockAt(pos);
            if (block) {
                try {
                    // Collect block handles movement automatically
                    await this.bot.collectBlock.collect(block);
                } catch (e) {
                    logger.error(`Failed to mine ${name}`, e);
                    // If pathfinding failed, maybe wander a bit to unstuck
                    if (e.name === 'Timeout' || e.message.includes('path')) {
                        this.bot.chat("не могу добраться, ищу обход");
                    }
                }
            }
        }
        return true;
    }

    async craft_item(args = {}) {
        const { name } = args;
        const count = Number.isFinite(Number(args.count)) ? Number(args.count) : 1;
        if (!name) return false;
        logger.info(`Requested craft: ${name} x${count}`);
        
        // Anti-spam: check if we already have tool/table
        if (['crafting_table', 'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'furnace'].includes(name)) {
            const hasItem = this.bot.inventory.items().find(i => i.name === name);
            if (hasItem) {
                logger.info(`Skipping craft ${name}, already have it`);
                return true;
            }
        }
        
        const itemData = this.bot.registry.itemsByName[name];
        if(!itemData) {
            this.bot.chat(`что такое ${name}? не знаю`);
            return false;
        }
        
        const recipes = this.bot.recipesFor(itemData.id, null, 1, null); // Check null world first (inv craft)
        let recipe = recipes[0];
        
        // If no inventory recipe, check crafting table recipes
        if (!recipe) {
             const craftingTableRecipes = this.bot.recipesFor(itemData.id, null, 1, true); // true = requires table
             recipe = craftingTableRecipes[0];
        }

        if(!recipe) {
            this.bot.chat(`не знаю как крафтить ${name} или нет ресов`);
            return false;
        }

        if (recipe.requiresTable) {
            // Find table
            let table = this.bot.findBlock({ matching: b => b.name === 'crafting_table', maxDistance: 4 });
            
            if (!table) {
                // Try to place one
                const tableItem = this.bot.inventory.items().find(i => i.name === 'crafting_table');
                if (tableItem) {
                     this.bot.chat("ставлю верстак...");
                     // Look at feet and place? Or nearby.
                     const nearby = this.bot.findBlock({ matching: b => b.type !== 0, maxDistance: 4 });
                     if (nearby) {
                         // Simplify: try to place nearby. 
                         // Real implementation of placing is hard, let's assume user placed it or bot finds a spot.
                         // For now, let's just ask LLM to place it using place_block manually if this fails.
                         this.bot.chat("нужен верстак рядом! поставь или скажи мне поставить.");
                         return false; 
                     }
                } else {
                    this.bot.chat("нужен верстак, а у меня нет.");
                    return false;
                }
            } else {
                 // Go to table
                 await this.bot.pathfinder.goto(new goals.GoalNear(table.position.x, table.position.y, table.position.z, 2));
                 try {
                    await this.bot.craft(recipe, count, table);
                    this.bot.chat(`скрафтил ${name}`);
                    return true;
                 } catch (e) {
                     logger.error("Crafting table failed", e);
                     this.bot.chat("не скрафтилось чет");
                     return false;
                 }
            }
        }

        try {
            await this.bot.craft(recipe, count, null);
            this.bot.chat(`скрафтил ${name}`);
            return true;
        } catch(e) {
            logger.error("Crafting failed", e);
            this.bot.chat("ошибка крафта");
            return false;
        }
    }
    
    async attack_entity(args = {}) {
        const { name } = args;
        if (!name) return;
        const target = this.bot.nearestEntity(e => e.name === name || (e.username && e.username === name));
        if (target) {
            this.bot.pvp.attack(target);
        }
    }

    async give_item(args = {}) {
        const { player_name, item_name } = args;
        const count = Number.isFinite(Number(args.count)) ? Number(args.count) : 1;
        if (!player_name || !item_name) return false;
        const target = this.bot.players[player_name]?.entity;
        
        if (!target) {
            this.bot.chat(`не вижу где ${player_name}`);
            return false;
        }

        const item = this.bot.inventory.items().find(i => i.name === item_name);
        if (!item) {
            this.bot.chat(`у меня нет ${item_name}`);
            return false;
        }

        // Look at player
        await this.bot.lookAt(target.position.offset(0, target.height, 0));
        
        // Toss item
        try {
            await this.bot.toss(item.type, null, Math.min(count, item.count));
            return true;
        } catch (e) {
            logger.error(`Failed to give ${item_name}`, e);
            return false;
        }
    }

    async defend() {
        if (!this.bot.pvp) return;
        const target = this.bot.nearestEntity(e => e.type === 'mob' && e.position.distanceTo(this.bot.entity.position) < 8);
        if (!target) {
            this.bot.chat('тут тихо');
            return;
        }
        this.bot.pvp.attack(target);
    }
    
    get_status() {
        return {
            health: this.bot.health,
            food: this.bot.food,
            position: this.bot.entity.position,
            inventory: this.bot.inventory.items().map(i => `${i.name} x${i.count}`)
        };
    }
}

module.exports = Skills;
