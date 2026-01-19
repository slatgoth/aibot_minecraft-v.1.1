const fs = require('fs');
const path = require('path');
const config = require('./config');

class MemoryStore {
    constructor() {
        this.filePath = config.paths.memory;
        this.data = {
            players: {},
            world: {}
        };
        this.lastSaveAt = 0;
        this.load();
    }

    load() {
        try {
            fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf8');
                this.data = JSON.parse(raw);
            } else {
                this.save();
            }
        } catch (e) {
            console.error('Memory load error:', e);
            this.data = { players: {}, world: {} };
        }
    }

    save() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
            this.lastSaveAt = Date.now();
        } catch (e) {
            console.error('Memory save error:', e);
        }
    }

    getPlayer(username) {
        if (!this.data.players[username]) {
            this.data.players[username] = {
                facts: [],
                interactions: [],
                aliases: [],
                trust: 0,
                lastSeen: null,
                lastPosition: null,
                muteUntil: null
            };
        }
        return this.data.players[username];
    }

    addFact(username, fact) {
        const p = this.getPlayer(username);
        const clean = String(fact || '').trim();
        if (!clean) return false;
        const normalized = this.normalizeFact(clean);
        const existingNormalized = p.facts.map(f => this.normalizeFact(f));
        if (existingNormalized.includes(normalized)) return false;

        p.facts.push(clean);
        const maxFacts = config.behavior.maxFactsPerPlayer || 50;
        if (p.facts.length > maxFacts) {
            p.facts.splice(0, p.facts.length - maxFacts);
        }
        this.save();
        return true;
    }

    removeFact(username, fact) {
        const p = this.getPlayer(username);
        const idx = p.facts.indexOf(fact);
        if (idx > -1) {
            p.facts.splice(idx, 1);
            this.save();
            return true;
        }
        return false;
    }

    logInteraction(username, type, content) {
        const p = this.getPlayer(username);
        p.interactions.push({
            timestamp: Date.now(),
            type,
            content
        });
        if (p.interactions.length > 50) p.interactions.shift();
        this.save();
    }

    setLastSeen(username, position) {
        const p = this.getPlayer(username);
        p.lastSeen = Date.now();
        p.lastPosition = position;
        if (Date.now() - this.lastSaveAt > 30000) {
            this.save();
        }
    }

    setMuted(username, durationMs) {
        const p = this.getPlayer(username);
        p.muteUntil = Date.now() + durationMs;
        this.save();
    }

    isMuted(username) {
        const p = this.getPlayer(username);
        if (!p.muteUntil) return false;
        if (Date.now() >= p.muteUntil) {
            p.muteUntil = null;
            return false;
        }
        return true;
    }

    normalizeFact(fact) {
        return String(fact || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' ');
    }

    getRecentInteractions(limit = 20) {
        const all = [];
        for (const [username, p] of Object.entries(this.data.players)) {
            for (const interaction of p.interactions || []) {
                all.push({
                    username,
                    timestamp: interaction.timestamp,
                    type: interaction.type,
                    content: interaction.content
                });
            }
        }
        all.sort((a, b) => b.timestamp - a.timestamp);
        return all.slice(0, limit);
    }
}

module.exports = new MemoryStore();
