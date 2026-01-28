const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { fork, spawn } = require('child_process')
const fs = require('fs')
const yaml = require('js-yaml')
const ollama = require('ollama').default

let mainWindow
let botProcess = null
let proxyProcess = null
let chatHistory = [] 
let lastConfig = {}
let startTimer = null
let envContext = "Environment: Scanning..."
let lastChatUser = ""
let lastChatMention = ""
let lastSystemAiAt = 0
const SYSTEM_AI_COOLDOWN_MS = 8000
let ttsQueue = Promise.resolve()
let ttsPending = 0
let ttsConfig = {
    enabled: false,
    modelPath: '',
    configPath: '',
    device: 'cpu',
    maxChars: 220,
    queueLimit: 2,
    modelsDir: path.join(__dirname, 'tts', 'models')
}

const memoryFile = path.join(__dirname, 'memory.json')
const allowedActions = new Set(['FOLLOW', 'GOTO', 'ATTACK', 'DROP', 'EQUIP', 'LOOKAT', 'STOP'])

function getMemoryData() {
    try {
        if (!fs.existsSync(memoryFile)) return { server_info: "", players: {} }
        return JSON.parse(fs.readFileSync(memoryFile, 'utf8'))
    } catch (e) { return { server_info: "", players: {} } }
}

function saveMemoryData(data) {
    fs.writeFileSync(memoryFile, JSON.stringify(data, null, 2))
}

function updatePlayerMemory(target, relation, note) {
    const data = getMemoryData()
    if (!data.players[target]) {
        data.players[target] = { relation: 'neutral', notes: '', first_seen: new Date().toISOString() }
    }
    if (relation) data.players[target].relation = relation
    if (note) {
        if (!data.players[target].notes.includes(note)) {
            data.players[target].notes += (data.players[target].notes ? '; ' : '') + note
        }
    }
    saveMemoryData(data)
    return data.players[target]
}

function normalizeAction(action) {
    return String(action || '').trim().toUpperCase()
}

function parseCmdJson(jsonStr) {
    try {
        const data = JSON.parse(jsonStr)
        if (!data || typeof data !== 'object') return null
        const action = normalizeAction(data.action)
        if (!allowedActions.has(action)) return null
        const params = (data.params && typeof data.params === 'object') ? data.params : {}
        return { action, params }
    } catch (e) {
        return null
    }
}

function extractTargetFromMessage(text) {
    if (!text) return ''
    const matches = text.match(/[A-Za-z0-9_]{3,16}/g) || []
    const filtered = matches.filter(m => !/^\d+$/.test(m))
    if (filtered.length === 0) return ''
    const candidate = filtered[filtered.length - 1]
    if (lastConfig && lastConfig.username && candidate.toLowerCase() === lastConfig.username.toLowerCase()) {
        return ''
    }
    return candidate
}

function fillMissingTarget(cmdData, fallbackTarget) {
    if (!cmdData || !cmdData.action) return cmdData
    const needsTarget = cmdData.action === 'FOLLOW' || cmdData.action === 'LOOKAT' || cmdData.action === 'ATTACK' || cmdData.action === 'DROP'
    if (!needsTarget) return cmdData
    if (!cmdData.params) cmdData.params = {}
    if (!cmdData.params.target) {
        const target = fallbackTarget || lastChatMention || lastChatUser
        if (target) cmdData.params.target = target
    }
    return cmdData
}

function resolveActionParams(cmdData, fallbackTarget) {
    if (!cmdData || !cmdData.action) return null
    const action = cmdData.action
    const params = cmdData.params || {}

    if (action === 'GOTO') {
        const x = Number(params.x)
        const y = Number(params.y)
        const z = Number(params.z)
        const hasCoords = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)
        if (hasCoords) {
            cmdData.params = { x, y, z }
            return cmdData
        }
        const target = params.target || fallbackTarget || lastChatMention || lastChatUser
        if (target) {
            return { action: 'FOLLOW', params: { target } }
        }
        return null
    }

    if (action === 'FOLLOW' || action === 'LOOKAT' || action === 'ATTACK') {
        if (!params.target) return null
    }

    return cmdData
}

function parseAnyActionJson(jsonStr) {
    try {
        const data = JSON.parse(jsonStr)
        if (!data || typeof data !== 'object') return null
        const action = normalizeAction(data.action)
        if (!action) return null
        return { action }
    } catch (e) {
        return null
    }
}

function stripLooseActionJson(text) {
    let out = ''
    let i = 0
    while (i < text.length) {
        const idx = text.indexOf('"action"', i)
        if (idx === -1) {
            out += text.slice(i)
            break
        }
        const start = text.lastIndexOf('{', idx)
        if (start === -1) {
            out += text.slice(i, idx + 8)
            i = idx + 8
            continue
        }
        let depth = 0
        let inString = false
        let escaped = false
        let j = start
        for (; j < text.length; j++) {
            const ch = text[j]
            if (escaped) { escaped = false; continue }
            if (ch === '\\') { escaped = true; continue }
            if (ch === '"') { inString = !inString; continue }
            if (!inString) {
                if (ch === '{') depth++
                else if (ch === '}') {
                    depth--
                    if (depth === 0) { j++; break }
                }
            }
        }
        if (depth === 0 && j > start) {
            const candidate = text.slice(start, j)
            if (parseAnyActionJson(candidate)) {
                out += text.slice(i, start)
                i = j
                continue
            }
        }
        out += text.slice(i, idx + 8)
        i = idx + 8
    }
    return out
}

function sanitizeAssistantReply(rawReply) {
    let cleaned = rawReply.replace(/<<<[\s\S]*?>>>/g, '\n')
    cleaned = cleaned.replace(/^\s*(?:⚡\s*)?(?:ACTION|DIRECTIVE|FOLLOWING|MOVING TO|AI THINKING|ДЕЙСТВИЕ|ДИРЕКТИВА)\b.*$/gmi, ' ')
    cleaned = stripLooseActionJson(cleaned)
    cleaned = cleaned.replace(/<br\s*\/?>/gi, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
    return cleaned
}

function getTtsPaths() {
    return {
        python: path.join(__dirname, 'tts', '.venv', 'Scripts', 'python.exe'),
        script: path.join(__dirname, 'tts', 'scripts', 'tts_piper.py'),
        outputs: path.join(__dirname, 'tts', 'outputs')
    }
}

function getTtsStatus() {
    if (!ttsConfig.enabled) return { ok: false, reason: 'TTS disabled' }
    const { python, script } = getTtsPaths()
    if (!fs.existsSync(python)) return { ok: false, reason: 'Python venv not found' }
    if (!fs.existsSync(script)) return { ok: false, reason: 'TTS script not found' }
    if (!ttsConfig.modelPath || !fs.existsSync(ttsConfig.modelPath)) return { ok: false, reason: 'Model not set' }
    if (ttsConfig.configPath && !fs.existsSync(ttsConfig.configPath)) return { ok: false, reason: 'Config not found' }
    return { ok: true, reason: 'Ready' }
}

function sendTtsStatus() {
    if (!mainWindow) return
    mainWindow.webContents.send('tts-status', getTtsStatus())
}

function logTts(text, level = 'info') {
    if (!mainWindow) return
    mainWindow.webContents.send('tts-log', { text: String(text), level })
}

function logTtsChunk(prefix, chunk, level = 'info') {
    const lines = chunk.toString().split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    for (const line of lines) logTts(`${prefix}${line}`, level)
}

function normalizeTtsText(text) {
    let cleaned = String(text || '').replace(/\s+/g, ' ').trim()
    if (!cleaned) return ''
    const maxChars = Number(ttsConfig.maxChars)
    if (Number.isFinite(maxChars) && maxChars > 0 && cleaned.length > maxChars) {
        cleaned = cleaned.slice(0, maxChars).trim() + '...'
    }
    return cleaned
}

function playWav(filePath) {
    return new Promise((resolve, reject) => {
        const safePath = filePath.replace(/'/g, "''")
        const cmd = `$p='${safePath}'; $player = New-Object System.Media.SoundPlayer $p; $player.Load(); $player.PlaySync();`
        const ps = spawn('powershell', ['-NoProfile', '-Command', cmd], { windowsHide: true })
        let stderr = ''
        ps.stderr.on('data', (d) => { stderr += d.toString() })
        ps.on('error', reject)
        ps.on('exit', (code) => {
            if (code !== 0) return reject(new Error(`Audio play failed (${code}): ${stderr.trim()}`))
            resolve()
        })
    })
}

function runTts(text) {
    return new Promise((resolve, reject) => {
        const status = getTtsStatus()
        if (!status.ok) return reject(new Error(status.reason))
        const { python, script, outputs } = getTtsPaths()
        if (!fs.existsSync(outputs)) fs.mkdirSync(outputs, { recursive: true })
        const outFile = path.join(outputs, `tts_${Date.now()}.wav`)
        logTts(`Generating audio (${text.length} chars)...`)
        const args = [
            '-u',
            script,
            '--text', text,
            '--out', outFile,
            '--model', ttsConfig.modelPath,
            '--config', ttsConfig.configPath || '',
            '--device', ttsConfig.device || 'cpu'
        ]
        const py = spawn(python, args, { windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1' } })
        let stderr = ''
        py.stdout.on('data', (d) => { logTtsChunk('TTS: ', d, 'info') })
        py.stderr.on('data', (d) => { stderr += d.toString() })
        py.on('error', reject)
        py.on('exit', (code) => {
            if (code !== 0) return reject(new Error(`TTS failed (${code}): ${stderr.trim()}`))
            logTts('Playing audio...')
            playWav(outFile).then(resolve).catch(reject)
        })
    })
}

function listVoices() {
    const { python, script } = getTtsPaths()
    if (!fs.existsSync(python)) {
        logTts('Python venv not found', 'error')
        return
    }
    if (!fs.existsSync(script)) {
        logTts('TTS script not found', 'error')
        return
    }
    if (!fs.existsSync(ttsConfig.modelsDir)) fs.mkdirSync(ttsConfig.modelsDir, { recursive: true })
    const args = [
        '-u',
        script,
        '--list_models',
        '--models_dir', ttsConfig.modelsDir
    ]
    logTts('Listing models...')
    const py = spawn(python, args, { windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: '1' } })
    py.stdout.on('data', (d) => logTtsChunk('TTS: ', d, 'info'))
    py.stderr.on('data', (d) => logTtsChunk('TTS: ', d, 'error'))
    py.on('exit', (code) => {
        if (code !== 0) logTts(`Voice list failed (${code})`, 'error')
    })
}

function enqueueTts(text) {
    const normalized = normalizeTtsText(text)
    if (!normalized) return
    const status = getTtsStatus()
    if (!status.ok) {
        sendTtsStatus()
        logTts(`Blocked: ${status.reason}`, 'warn')
        return
    }
    const limit = Number(ttsConfig.queueLimit || 0)
    if (limit > 0 && ttsPending >= limit) {
        logTts('Queue full, dropping TTS', 'warn')
        return
    }
    ttsPending += 1
    ttsQueue = ttsQueue
        .then(() => runTts(normalized))
        .then(() => logTts('Done'))
        .catch((err) => {
            mainWindow.webContents.send('log', { text: `TTS Error: ${err.message}`, type: 'error' })
            logTts(`Error: ${err.message}`, 'error')
            sendTtsStatus()
        })
        .finally(() => { ttsPending = Math.max(0, ttsPending - 1) })
}

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1300, height: 850,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    autoHideMenuBar: true, backgroundColor: '#0f0c29', title: 'Minecraft AI Bot v1.3.0'
  })
  mainWindow.loadFile('index.html')
  mainWindow.webContents.on('did-finish-load', () => sendTtsStatus())
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (botProcess) botProcess.kill()
  if (proxyProcess) proxyProcess.kill()
  app.quit()
})

ipcMain.on('start-bot', (event, config) => {
  if (botProcess || startTimer) return
  lastConfig = config
  
  event.reply('log', { text: 'Starting Bot process...', type: 'info' })
  
  const memoryInstruction = `
[HIDDEN INSTRUCTION: MEMORY & ACTION PROTOCOLS]
You are an advanced AI agent in Minecraft.

1. MEMORY PROTOCOL:
If you learn something new about a player or the world (especially LOCATIONS/COORDINATES), output a hidden JSON block at the end.
Format: <<<MEM:{"target":"player_name", "relation":"friend|neutral|enemy", "note":"fact", "global_note":"world fact"}>>>

2. ACTION PROTOCOL:
You MUST output a hidden JSON block at the end of your message to perform any physical movement.
- VALID COMMANDS: FOLLOW, GOTO, ATTACK, DROP, EQUIP, LOOKAT, STOP.
- FORMAT EXAMPLE:
<<<CMD:{"action":"FOLLOW","params":{"target":"PlayerName"}}>>>
<<<CMD:{"action":"GOTO","params":{"x":0,"y":64,"z":0}}>>>
<<<CMD:{"action":"DROP","params":{"item":"Egg","target":"PlayerName"}}>>>
`
  
  const systemContent = config.prompt + ` (My name is ${config.username}).\n` + memoryInstruction
  chatHistory = [{ role: 'system', content: systemContent }]

  mainWindow.webContents.send('log', { text: 'Waiting for Proxy warmup (8s)...', type: 'info' })

  startTimer = setTimeout(() => {
      startTimer = null
      try {
          botProcess = fork(path.join(__dirname, 'bot_wrapper.js'), [JSON.stringify(config)], {
            stdio: ['pipe', 'pipe', 'pipe', 'ipc']
          })
          setupBotListeners()
      } catch (e) {
          mainWindow.webContents.send('log', { text: 'FORK ERROR: ' + e.message, type: 'error' })
      }
  }, 8000)
})

function setupBotListeners() {
    if (!botProcess) return

    botProcess.on('message', async (msg) => {
        if (msg.type === 'log') {
            mainWindow.webContents.send('log', { text: msg.text, type: msg.logType })
        }
        else if (msg.type === 'env_update') {
            const d = msg.data
            envContext = `[VISUALS]: Time: ${d.time}. Standing on: ${d.floor}. Nearby: ${d.nearby}.`
        }
        else if (msg.type === 'inventory_data') {
            mainWindow.webContents.send('inventory-update', msg.data)
        }
        else if (msg.type === 'chat_event') {
            const { username, message } = msg
            lastChatUser = username
            lastChatMention = extractTargetFromMessage(message)
            const memData = getMemoryData()
            const playerInfo = memData.players[username]
            
            let contextNote = `[SYSTEM: HIDDEN MEMORY LAYER]`
            if (playerInfo) {
                contextNote += ` Known Player: ${username}. Relation: ${playerInfo.relation}. Notes: ${playerInfo.notes}.`
            }
            contextNote += ` Server Facts: ${memData.server_info}. Bot Position: ${JSON.stringify(msg.position || 'unknown')}`

            chatHistory.push({ role: 'system', content: contextNote })
            chatHistory.push({ role: 'user', content: `${username}: ${message}` })
            if (chatHistory.length > 20) chatHistory = [chatHistory[0], ...chatHistory.slice(-19)]

            if (username === 'SYSTEM') {
                const now = Date.now()
                if (now - lastSystemAiAt < SYSTEM_AI_COOLDOWN_MS) {
                    mainWindow.webContents.send('log', { text: `[SYSTEM] ${message}`, type: 'info' })
                    return
                }
                lastSystemAiAt = now
            }

            try {
                mainWindow.webContents.send('log', { text: `AI Thinking...`, type: 'ai' })
                
                const messagesWithReminder = [...chatHistory, {
                    role: 'system',
                    content: `[SYSTEM REMINDER]\n1. PERSONALITY: ${lastConfig.prompt}\n2. SENSES: ${envContext}\n3. MANDATE: You MUST include a <<<CMD>>> block if agreeing to act.\nFormat: <<<CMD:{"action":"FOLLOW","params":{"target":"PlayerName"}}>>>\nIf giving an item, include target: <<<CMD:{"action":"DROP","params":{"item":"Egg","target":"PlayerName"}}>>>\nValid: FOLLOW, GOTO, ATTACK, DROP, EQUIP, LOOKAT, STOP.`
                }]

                const response = await ollama.chat({ model: lastConfig.model, messages: messagesWithReminder })
                let reply = response.message.content
                let rawReply = reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
                let cleanReply = rawReply

                // Parse MEM
                const memRegex = /<<<MEM:([\s\S]*?)>>>/g
                let mMatch
                while ((mMatch = memRegex.exec(rawReply)) !== null) {
                    try {
                        const memUpdate = JSON.parse(mMatch[1].replace(/\n/g, ' '))
                        if (memUpdate.target) updatePlayerMemory(memUpdate.target, memUpdate.relation, memUpdate.note)
                        if (memUpdate.global_note) {
                            const d = getMemoryData(); d.server_info += (d.server_info ? "; " : "") + memUpdate.global_note; saveMemoryData(d);
                        }
                    } catch (e) {}
                }

                // Parse CMD
                const cmdRegexGlobal = /<<<CMD:([\s\S]*?)>>>/g
                let cMatch
                while ((cMatch = cmdRegexGlobal.exec(rawReply)) !== null) {
                    try {
                        const jsonStr = cMatch[1].replace(/\n/g, ' ')
                        let cmdData = parseCmdJson(jsonStr)
                        if (!cmdData) continue
                        cmdData = fillMissingTarget(cmdData, lastChatMention || username)
                        cmdData = resolveActionParams(cmdData, lastChatMention || username)
                        if (!cmdData) continue
                        botProcess.send({ type: 'ai_action', action: cmdData.action, params: cmdData.params })
                        mainWindow.webContents.send('log', { text: `⚡ ACTION: ${cmdData.action}`, type: 'ai' })
                    } catch (e) { }
                }

                cleanReply = sanitizeAssistantReply(rawReply)
                mainWindow.webContents.send('log', { text: `AI: ${cleanReply}`, type: 'ai' })
                chatHistory.push({ role: 'assistant', content: cleanReply })
                if (cleanReply) {
                    botProcess.send({ type: 'speak', text: cleanReply })
                    enqueueTts(cleanReply)
                }

            } catch (err) {
                mainWindow.webContents.send('log', { text: `AI Error: ${err.message}`, type: 'error' })
            }
        }
    })

    botProcess.on('exit', (code) => {
        botProcess = null
        mainWindow.webContents.send('log', { text: `Bot process exited with code ${code}`, type: 'error' })
    })

    botProcess.stderr.on('data', (data) => {
        mainWindow.webContents.send('log', { text: `BOT CRASH: ${data}`, type: 'error' })
    })
}

ipcMain.on('stop-bot', () => {
    if (startTimer) { clearTimeout(startTimer); startTimer = null; }
    if (botProcess) { botProcess.kill(); botProcess = null; }
    mainWindow.webContents.send('log', { text: 'Bot Emergency Stop', type: 'error' })
})

ipcMain.on('bot-command', (e, cmd) => { if(botProcess) botProcess.send({ type: 'command', text: cmd }) })
ipcMain.on('manual-action', (e, { action, state }) => { if(botProcess) botProcess.send({ type: 'manual_control', action, state }) })
ipcMain.on('move-item', (e, { from, to }) => { if(botProcess) botProcess.send({ type: 'move_item', from, to }) })
ipcMain.on('drop-item', (e, { slot, count }) => { if(botProcess) botProcess.send({ type: 'drop_item', slot, count }) })
ipcMain.on('tts-config', (e, config) => {
    ttsConfig = {
        ...ttsConfig,
        enabled: !!config.enabled,
        modelPath: String(config.modelPath || ttsConfig.modelPath),
        configPath: String(config.configPath || ttsConfig.configPath),
        device: String(config.device || ttsConfig.device),
        maxChars: Number.isFinite(Number(config.maxChars)) ? Number(config.maxChars) : ttsConfig.maxChars,
        queueLimit: Number.isFinite(Number(config.queueLimit)) ? Number(config.queueLimit) : ttsConfig.queueLimit,
        modelsDir: String(config.modelsDir || ttsConfig.modelsDir)
    }
    sendTtsStatus()
    const status = getTtsStatus()
    logTts(`Config updated (${status.reason})`)
})
ipcMain.on('tts-test', (e, text) => {
    logTts('Test requested')
    enqueueTts(String(text || ''))
})
ipcMain.on('tts-list-models', () => {
    listVoices()
})

ipcMain.on('direct-instruction', async (e, text) => {
    if(!botProcess) return
    
    if (text.toLowerCase().includes('прости') || text.toLowerCase().includes('forgive')) {
        const data = getMemoryData()
        Object.keys(data.players).forEach(p => {
            data.players[p].relation = 'neutral'
            data.players[p].notes += '; (Forgiven)'
        })
        saveMemoryData(data)
        mainWindow.webContents.send('log', { text: `🕊️ GLOBAL AMNESTY EXECUTED`, type: 'memory' })
    }

    mainWindow.webContents.send('log', { text: `⚠️ DIRECTIVE: ${text}`, type: 'ai' })
    try {
        const baseSystem = chatHistory[0] ? [chatHistory[0]] : []
        const directMessages = [
            ...baseSystem,
            { role: 'system', content: `[SYSTEM REMINDER]\n1. PERSONALITY: ${lastConfig.prompt}\n2. SENSES: ${envContext}\n3. MANDATE: You MUST include a <<<CMD>>> block if agreeing to act.\nFormat: <<<CMD:{"action":"FOLLOW","params":{"target":"PlayerName"}}>>>\nIf giving an item, include target: <<<CMD:{"action":"DROP","params":{"item":"Egg","target":"PlayerName"}}>>>\nValid: FOLLOW, GOTO, ATTACK, DROP, EQUIP, LOOKAT, STOP.` },
            { role: 'user', content: `[SYSTEM OVERRIDE]: ${text}` }
        ]
        const response = await ollama.chat({ model: lastConfig.model, messages: directMessages })
        let reply = response.message.content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
        
        const cmdRegexGlobal = /<<<CMD:([\s\S]*?)>>>/g
        let match
        while ((match = cmdRegexGlobal.exec(reply)) !== null) {
            try {
                let cmdData = parseCmdJson(match[1].replace(/\n/g, ' '))
                if (!cmdData) continue
                cmdData = fillMissingTarget(cmdData, extractTargetFromMessage(text) || lastChatMention || lastChatUser)
                cmdData = resolveActionParams(cmdData, extractTargetFromMessage(text) || lastChatMention || lastChatUser)
                if (!cmdData) continue
                botProcess.send({ type: 'ai_action', action: cmdData.action, params: cmdData.params })
                mainWindow.webContents.send('log', { text: `⚡ ACTION: ${cmdData.action}`, type: 'ai' })
            } catch (e) { }
        }

        let cleanReply = sanitizeAssistantReply(reply)
        mainWindow.webContents.send('log', { text: `AI: ${cleanReply}`, type: 'ai' })
        if (cleanReply) {
            botProcess.send({ type: 'speak', text: cleanReply })
            enqueueTts(cleanReply)
        }
    } catch (err) { mainWindow.webContents.send('log', { text: `Error: ${err.message}`, type: 'error' }) }
})

ipcMain.on('get-memory-db', (event) => { event.reply('memory-db-data', getMemoryData()) })
ipcMain.on('save-memory-db', (event, data) => { saveMemoryData(data); event.reply('log', { text: 'Memory Saved.', type: 'info' }) })

ipcMain.on('start-proxy', (event, config) => {
  if (proxyProcess) return
  const proxyPath = path.join(__dirname, '../ViaProxy')
  const ymlPath = path.join(proxyPath, 'viaproxy.yml')
  try {
    let doc = yaml.load(fs.readFileSync(ymlPath, 'utf8')) || {}
    doc['target-address'] = config.target.trim()
    doc['target-version'] = config.version
    fs.writeFileSync(ymlPath, yaml.dump(doc))
  } catch (e) {}
  proxyProcess = spawn('java', ['-jar', path.join(proxyPath, 'ViaProxy-3.4.8.jar')], { cwd: proxyPath })
  proxyProcess.stdout.on('data', (d) => { if(d.toString().includes('INFO')) mainWindow.webContents.send('log', { text: `[ViaProxy] ${d}`, type: 'info' }) })
  proxyProcess.on('close', () => { proxyProcess = null; })
})

ipcMain.on('stop-proxy', () => { if (proxyProcess) { proxyProcess.kill(); proxyProcess = null; } })
ipcMain.on('get-inventory', () => { if(botProcess) botProcess.send({ type: 'get_inventory' }) })
ipcMain.on('get-models', async (event) => {
    try {
        const list = await ollama.list()
        event.reply('models-list', list.models)
    } catch (e) { event.reply('log', { text: 'Ollama Error', type: 'error' }) }
})
