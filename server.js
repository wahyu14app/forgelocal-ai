import express from 'express';
import fs from 'fs-extra';
import path from 'path';
import { exec } from 'child_process';
import { getLlama, LlamaChatSession } from 'node-llama-cpp';
import cors from 'cors';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(cors({ origin: '*' }));

// FIX: Baris ini untuk mengatasi "Cannot GET /" saat dijalankan di lokal
app.use(express.static(path.join(__dirname, 'docs')));

const PORT = 5000;

// Konfigurasi Default
let config = {
    workspacePath: path.join(__dirname, 'workspace_default'),
    modelPath: '', 
    contextSize: 2048,
    systemPrompt: "Anda adalah AI asisten pengembang software. Anda dapat memberikan instruksi manipulasi file atau perintah terminal."
};

fs.ensureDirSync(config.workspacePath);

let llama = null;
let model = null;
let context = null;

async function initAI() {
    if (!config.modelPath || !await fs.pathExists(config.modelPath)) {
        console.log("Model GGUF belum diset atau tidak ditemukan.");
        return false;
    }
    try {
        console.log(`Memuat model GGUF dari: ${config.modelPath}...`);
        llama = await getLlama();
        model = await llama.loadModel({ modelPath: config.modelPath });
        context = await model.createContext({ contextSize: config.contextSize });
        console.log("Model AI Offline berhasil dimuat!");
        return true;
    } catch (err) {
        console.error("Gagal memuat model:", err.message);
        return false;
    }
}

// 1. ENDPOINT: CONFIG
app.post('/api/config', async (req, res) => {
    const { workspacePath, modelPath, contextSize, systemPrompt } = req.body;
    if (workspacePath) config.workspacePath = path.resolve(workspacePath);
    if (contextSize) config.contextSize = Number(contextSize);
    if (systemPrompt) config.systemPrompt = systemPrompt;
    
    let modelChanged = false;
    if (modelPath && modelPath !== config.modelPath) {
        config.modelPath = modelPath;
        modelChanged = true;
    }

    fs.ensureDirSync(config.workspacePath);
    let aiReady = true;
    if (modelChanged) aiReady = await initAI();

    res.json({ success: true, message: "Konfigurasi diperbarui", config, aiReady });
});

app.get('/api/config', (req, res) => res.json(config));

// 2. ENDPOINT: FILE SYSTEM
app.post('/api/fs', async (req, res) => {
    const { action, filePath, content } = req.body;
    const safePath = path.resolve(config.workspacePath, filePath);

    if (!safePath.startsWith(config.workspacePath)) {
        return res.status(403).json({ error: "Akses di luar workspace dilarang!" });
    }

    try {
        if (action === 'read') {
            if (!await fs.pathExists(safePath)) return res.json({ content: '' });
            const data = await fs.readFile(safePath, 'utf-8');
            return res.json({ success: true, content: data });
        } else if (action === 'write') {
            await fs.outputFile(safePath, content, 'utf-8');
            return res.json({ success: true, message: "File berhasil disimpan" });
        }
        res.status(400).json({ error: "Aksi tidak valid" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. ENDPOINT: TERMINAL
app.post('/api/terminal', (req, res) => {
    const { command } = req.body;
    if (!command) return res.status(400).json({ error: "Command kosong" });

    exec(command, { cwd: config.workspacePath }, (error, stdout, stderr) => {
        res.json({
            success: !error,
            stdout: stdout || '',
            stderr: stderr || (error ? error.message : '')
        });
    });
});

// 4. ENDPOINT: CHAT
app.post('/api/chat', async (req, res) => {
    const { prompt } = req.body;
    if (!context) return res.status(400).json({ error: "AI belum siap. Atur file GGUF Anda terlebih dahulu." });

    try {
        const session = new LlamaChatSession({ contextSequence: context.getSequence() });
        const fullPrompt = `${config.systemPrompt}\n\nUser: ${prompt}\nAI:`;
        const response = await session.prompt(fullPrompt);
        res.json({ success: true, response });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`ForgeLocal.AI berjalan di http://localhost:${PORT}`);
});

