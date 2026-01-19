const memory = require('./memory_store');

class Perception {
    constructor(bot) {
        this.bot = bot;
    }

    scan() {
        const bot = this.bot;
        const pos = bot.entity.position;
        
        const entities = Object.values(bot.entities)
            .filter(e => e.id !== bot.entity.id && e.position.distanceTo(pos) < 20)
            .map(e => ({
                id: e.id,
                name: e.name || e.username || 'unknown',
                type: e.type,
                distance: e.position.distanceTo(pos).toFixed(1),
                position: e.position
            }));

        const blocks = bot.findBlocks({
            matching: (block) => block.type !== 0, // Not air
            maxDistance: 5,
            count: 10
        }).map(p => {
            const b = bot.blockAt(p);
            return b.name;
        });

        const players = Object.values(bot.players).map(p => {
            const name = p.username;
            let position = null;
            let distance = null;
            let hasEntity = false;
            let lastSeen = null;
            let lastPosition = null;

            if (p.entity && p.entity.position) {
                hasEntity = true;
                position = {
                    x: Math.floor(p.entity.position.x),
                    y: Math.floor(p.entity.position.y),
                    z: Math.floor(p.entity.position.z)
                };
                distance = Number(p.entity.position.distanceTo(pos).toFixed(1));
                memory.setLastSeen(name, position);
                lastSeen = Date.now();
                lastPosition = position;
            } else {
                const mem = memory.getPlayer(name);
                lastSeen = mem.lastSeen || null;
                lastPosition = mem.lastPosition || null;
            }

            return {
                name,
                position,
                distance,
                hasEntity,
                muted: memory.isMuted(name),
                lastSeen,
                lastPosition
            };
        });

        return {
            time: bot.time.timeOfDay,
            isDay: bot.time.isDay,
            biome: bot.blockAt(pos)?.biome?.name || 'unknown',
            nearbyEntities: entities,
            nearbyBlocks: [...new Set(blocks)], // unique
            players,
            playersOnline: players.map(p => p.name),
            health: bot.health,
            food: bot.food,
            inventory: bot.inventory.items().map(i => `${i.name} x${i.count}`),
            position: { x: Math.floor(pos.x), y: Math.floor(pos.y), z: Math.floor(pos.z) }
        };
    }
}

module.exports = Perception;
