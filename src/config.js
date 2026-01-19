const path = require('path');

const envInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
};

module.exports = {
    bot: {
        host: process.env.BOT_HOST || 'localhost', // Connected via local proxy port usually
        port: envInt(process.env.BOT_PORT, 25568), // Proxy port configured in viaproxy.yml
        username: process.env.BOT_USERNAME || 'bot',
        version: process.env.BOT_VERSION || '1.21.4', // Connection version (proxy handles target)
        auth: process.env.BOT_AUTH || 'offline'
    },
    proxy: {
        // Proxy target for reference (optional)
        targetHost: process.env.MC_SERVER_HOST || 'example.com',
        targetPort: envInt(process.env.MC_SERVER_PORT, 25565)
    },
    llm: {
        host: process.env.OLLAMA_HOST || 'http://127.0.0.1:11434',
        defaultModel: process.env.OLLAMA_MODEL || 'deepseek-llm', // Will be auto-detected
        contextWindow: envInt(process.env.OLLAMA_CONTEXT, 8192),
        temperature: Number.isFinite(Number(process.env.OLLAMA_TEMPERATURE))
            ? Number(process.env.OLLAMA_TEMPERATURE)
            : 0.7
    },
    paths: {
        memory: path.join(__dirname, '../data/memory.json'),
        logs: path.join(__dirname, '../logs'),
        items: path.join(__dirname, '../data/minecraft_1.21.11_blocks_items_en.json'),
        recipes: path.join(__dirname, '../data/mineflayer_recipes_minecraft_1.21.11.json')
    },
    behavior: {
        defaultMode: 'manual', // 'manual' or 'autonomous'
        commandPrefixes: ['bot,'],
        chatCooldown: 5000,
        globalChatCooldown: 0,
        maxChatHistory: 20,
        socialRoundInterval: 500000,
        perPlayerChatCooldown: 120000,
        maxFactsPerPlayer: 50,
        etiquetteMuteMinutes: 10
    }
};
