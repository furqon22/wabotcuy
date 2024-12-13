const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const { unlinkSync } = require('fs');
const qrcode = require('qrcode-terminal');
const Groq = require("groq-sdk"); // Import Groq

// Inisialisasi Groq dengan API Key
const groq = new Groq({ apiKey: '' });

// Objek untuk menyimpan riwayat percakapan berdasarkan nomor
const memory = {};

// Fungsi untuk mendapatkan respons chat dari Groq dengan mempertimbangkan konteks
async function getGroqChatCompletion(number, question) {
    try {
        console.log('Mengirim pertanyaan ke Groq:', question);

        // Ambil riwayat percakapan dari memori
        const messages = memory[number] || [];
        messages.push({
            role: "user",
            content: question,
        });

        const response = await groq.chat.completions.create({
            messages,
            model: "llama-3.3-70b-versatile",
        });

        const answer = response.choices[0]?.message?.content || "Maaf, saya tidak dapat menjawab pertanyaan Anda saat ini.";

        // Tambahkan jawaban ke riwayat percakapan
        messages.push({
            role: "assistant",
            content: answer,
        });

        // Simpan kembali riwayat percakapan ke memori
        memory[number] = messages;

        console.log('Respons dari server Groq diterima:', response);
        return answer;
    } catch (error) {
        console.error('Error mendapatkan respons dari Groq:', error);
        return "Maaf, terjadi kesalahan pada server Groq.";
    }
}

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info_multi');

    const sock = makeWASocket({
        auth: state,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) {
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = update.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Koneksi terputus, mencoba menghubungkan ulang...', shouldReconnect);
            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log('Sesi berakhir. Anda telah logout.');
                unlinkSync('./auth_info_multi');
            }
        } else if (connection === 'open') {
            console.log('Koneksi berhasil!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type === 'notify') {
            const message = messages[0];
            const remoteJid = message.key.remoteJid;
            if (!message.key.fromMe && message.message) {
                const messageContent = message.message.conversation || message.message.extendedTextMessage?.text || '';

                console.log('Pesan diterima:', messageContent);

                if (messageContent.trim()) {
                    try {
                        const answer = await getGroqChatCompletion(remoteJid, messageContent);
                        await sock.sendMessage(remoteJid, { text: answer });
                        console.log('Jawaban dari Groq berhasil dikirim:', answer);
                    } catch (error) {
                        console.error('Terjadi kesalahan saat menghubungi API Groq:', error);
                        await sock.sendMessage(remoteJid, { text: 'Maaf, terjadi kesalahan pada server Groq. Silakan kirim ulang pesan.' });
                    }
                }
            }
        }
    });
}

connectToWhatsApp();
