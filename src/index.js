const mineflayer = require('mineflayer');
const { pathfinder, Movements } = require('mineflayer-pathfinder');
const pvp = require('mineflayer-pvp').plugin;
const armorManager = require('mineflayer-armor-manager');
const autoEat = require('mineflayer-auto-eat').plugin;
const collectBlock = require('mineflayer-collectblock').plugin;

const config = require('./config');
const { logger } = require('./utils');
const Skills = require('./skills');
const Perception = require('./perception');
const Planner = require('./planner');
const ChatHandler = require('./chat');
const llm = require('./llm_client');
const Reflexes = require('./reflexes');
const Observer = require('./observer');

function createBot() {
    logger.info('Starting bot...');
    
    const bot = mineflayer.createBot({
        host: config.bot.host,
        port: config.bot.port,
        username: config.bot.username,
        version: config.bot.version, // Connection version (1.21.4 for ViaProxy)
        auth: config.bot.auth
    });

    // Load plugins
    bot.loadPlugin(pathfinder);
    bot.loadPlugin(pvp);
    // bot.loadPlugin(armorManager); // Disabled due to crash
    bot.loadPlugin(autoEat);
    bot.loadPlugin(collectBlock);

    // Initialize modules once spawned
    bot.once('spawn', () => {
        logger.info('Bot spawned!');
        
        const mcData = require('minecraft-data')(bot.version);
        const defaultMove = new Movements(bot, mcData);
        bot.pathfinder.setMovements(defaultMove);

        const skills = new Skills(bot);
        const perception = new Perception(bot);
        const planner = new Planner(bot, skills, perception);
        const chatHandler = new ChatHandler(bot, planner);
        const reflexes = new Reflexes(bot, planner);
        const observer = new Observer(bot);

        chatHandler.init();
        planner.start();
        reflexes.start();
        observer.start();
        
        // Init LLM
        llm.init().then(() => logger.info('LLM initialized'));

        // Idle behavior: Look at nearest player
        setInterval(() => {
            if (bot.pathfinder.isMoving()) return;
            
            const entity = bot.nearestEntity(e => e.type === 'player');
            if (entity && entity.position.distanceTo(bot.entity.position) < 5) {
                bot.lookAt(entity.position.offset(0, entity.height, 0));
            }
        }, 100);

        bot.on('death', () => {
             logger.warn('Bot died');
             // Anti-lose logic can be added here
        });
    });

    bot.on('kicked', console.log);
    bot.on('error', console.log);
    
    return bot;
}

createBot();
