const { google } = require('googleapis');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const User = require('../models/user.model');
const CronLock = require('../models/cronLock.model');

// --- CREDENTIALS (should be in .env) ---
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REFRESH_TOKEN = process.env.GMAIL_REFRESH_TOKEN;
const EMAIL_TO = process.env.EMAIL_TO || "posmarcosalch@gmail.com";
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || "*/15 * * * *";

// Validate credentials at startup
function validateCredentials() {
    const missing = [];
    if (!GMAIL_USER) missing.push('GMAIL_USER');
    if (!GMAIL_CLIENT_ID) missing.push('GMAIL_CLIENT_ID');
    if (!GMAIL_CLIENT_SECRET) missing.push('GMAIL_CLIENT_SECRET');
    if (!GMAIL_REFRESH_TOKEN) missing.push('GMAIL_REFRESH_TOKEN');

    if (missing.length > 0) {
        console.error('[EmailService] ⚠️  CREDENCIALES FALTANTES:', missing.join(', '));
        return false;
    }
    return true;
}

const credentialsValid = validateCredentials();

const oauth2Client = new google.auth.OAuth2(
    GMAIL_CLIENT_ID,
    GMAIL_CLIENT_SECRET,
    "https://developers.google.com/oauthplayground"
);

if (credentialsValid && GMAIL_REFRESH_TOKEN) {
    oauth2Client.setCredentials({
        refresh_token: GMAIL_REFRESH_TOKEN
    });
}

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

/**
 * Generates a CSV string from user data.
 */
async function generateUserReportCSV() {
    const users = await User.find({}, 'username saldo rol').lean();

    // Header
    let csvContent = "Username,Saldo,Rol\n";

    // Rows
    users.forEach(user => {
        csvContent += `${user.username},${user.saldo || 0},${user.rol || ''}\n`;
    });

    return csvContent;
}

/**
 * Creates a raw MIME email string with attachment.
 */
function makeBody(to, from, subject, message, attachmentContent, attachmentName) {
    const boundary = "__myapp__";
    const nl = "\n";

    let str = "";

    str += `MIME-Version: 1.0${nl}`;
    str += `To: ${to}${nl}`;
    str += `From: ${from}${nl}`;
    str += `Subject: ${subject}${nl}`;
    str += `Content-Type: multipart/mixed; boundary="${boundary}"${nl}${nl}`;

    str += `--${boundary}${nl}`;
    str += `Content-Type: text/plain; charset="UTF-8"${nl}`;
    str += `Content-Transfer-Encoding: 7bit${nl}${nl}`;
    str += `${message}${nl}${nl}`;

    if (attachmentContent) {
        str += `--${boundary}${nl}`;
        str += `Content-Type: text/csv; name="${attachmentName}"${nl}`;
        str += `Content-Disposition: attachment; filename="${attachmentName}"${nl}`;
        str += `Content-Transfer-Encoding: base64${nl}${nl}`;
        str += `${Buffer.from(attachmentContent).toString('base64')}${nl}`;
    }

    str += `--${boundary}--`;

    return str;
}

/**
 * Sends the activity report email.
 */
async function sendActivityReport() {
    if (!credentialsValid) {
        throw new Error('Gmail credentials not configured. Please check your .env file.');
    }

    try {
        const csvContent = await generateUserReportCSV();
        const dateStr = new Date().toISOString().split('T')[0];
        const fileName = `reporte_actividad_${dateStr}.csv`;

        const rawMessage = makeBody(
            EMAIL_TO,
            GMAIL_USER,
            `Reporte de Actividad - ${new Date().toLocaleString()}`,
            "Adjunto encontrarás el reporte de actividad más reciente.",
            csvContent,
            fileName
        );

        const encodedMessage = Buffer.from(rawMessage)
            .toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '');

        const res = await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage,
            },
        });

        return { success: true, messageId: res.data.id };

    } catch (error) {
        console.error('[EmailService] Error enviando correo:', error);
        throw error;
    }
}

/**
 * Tries to acquire a distributed lock using atomic operations.
 * Returns true if lock acquired, false if already locked/recently run.
 * This prevents race conditions when multiple replicas try to acquire the lock simultaneously.
 */
async function acquireLock(lockName) {
    const LOCK_DURATION_MS = 14 * 60 * 1000; // ~14 min (para cron de 15 min)
    const now = new Date();
    const threshold = new Date(now.getTime() - LOCK_DURATION_MS);

    try {
        // OPERACIÓN ATÓMICA: Intenta actualizar solo si el lock no existe o es viejo
        const result = await CronLock.findOneAndUpdate(
            {
                name: lockName,
                $or: [
                    { lastRun: { $lt: threshold } }, // Lock viejo
                    { lastRun: { $exists: false } }   // Lock no existe
                ]
            },
            {
                $set: {
                    lastRun: now,
                    status: 'LOCKED',
                    replicaId: process.env.HOSTNAME || process.pid.toString()
                }
            },
            {
                upsert: true,  // Crear si no existe
                new: true,     // Retornar el documento actualizado
                setDefaultsOnInsert: true
            }
        );

        // Si result es null, significa que otra réplica ya tiene el lock
        if (result) {
            return true;
        }
        return false;

    } catch (error) {
        // Si hay error de duplicado (E11000), otra réplica ganó la carrera
        if (error.code === 11000) {
            return false;
        }
        throw error;
    }
}

/**
 * Initializes the Cron Job.
 */
function initCron() {
    cron.schedule(CRON_SCHEDULE, async () => {
        try {
            const hasLock = await acquireLock('activity-report');
            if (hasLock) {
                await sendActivityReport();
            }
        } catch (error) {
            console.error('[EmailService] Error en CRON:', error);
        }
    });
}

module.exports = {
    sendActivityReport,
    initCron
};
