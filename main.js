// main.js
const TelegramBot = require('node-telegram-bot-api');
const registerLocationHandlers = require('./location_handlers');
const { registerDeliveryHandlers } = require('./delivery_handlers'); // Faqat funksiyani import qilish
const registerPaymentHandlers = require('./payment_handlers');

// --- Global Variables ---
const TOKEN = '8057214490:AAE94rTihDbBRrwqCeoYHwkolRsKh3GDMgs'; // Bot tokeningizni qo'ying
const WEB_APP_URL = 'https://charming-cucurucho-1c5f99.netlify.app/telegram.html'; // Web App URL
const ADMIN_CHAT_ID = 1205534758; // Admin ID raqamingiz

// --- Data Storage ---
const userData = {};       // User-specific data (orders, name, phone, location, etc.)
const activeUsers = new Set(); // User IDs who have interacted (for broadcasting)
const userStates = {};     // User FSM-like states (key: userId, value: { state: '...', data: {...} })

// --- State Definitions --- (Reklama uchun)
const AdvertisementStates = {
    WAITING_FOR_CONTENT: 'waiting_for_ad_content' // Nomini aniqroq qilish
};

// --- Bot Initialization ---
const bot = new TelegramBot(TOKEN, { polling: true });

console.log('Bot starting...');

// --- Core Handlers (/start, Bosh sahifa) ---

bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    activeUsers.add(userId);

    // Clean up any previous state or data for the user on /start
    delete userStates[userId];
    // delete userData[userId]; // Optional: Decide if you want to clear all user data on /start

    const options = {
        reply_markup: {
            keyboard: [
                [{ text: '🌸 Gullar katalogi', web_app: { url: WEB_APP_URL } }],
                 // Bosh sahifa tugmasini qo'shish mumkin, agar kerak bo'lsa
                 [{ text: '🏠 Bosh sahifa' }]
            ],
            resize_keyboard: true
        }
    };
    bot.sendMessage(chatId, 'Assalomu alaykum! 🌸 Gul do\'konimizga xush kelibsiz!', options);
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;

    // Handle '🏠 Bosh sahifa' only if it's text and user is not in a state
    if (text === '🏠 Bosh sahifa' && !userStates[userId]) {
        activeUsers.add(userId);
         // Clean up potential leftover order data if returning home explicitly
         if (userData[userId]) {
             delete userData[userId].order;
             delete userData[userId].delivery_type;
             delete userData[userId].location;
             delete userData[userId].payment_proof;
         }

        const options = {
            reply_markup: {
                keyboard: [
                    [{ text: '🌸 Gullar katalogi', web_app: { url: WEB_APP_URL } }],
                    [{ text: '🏠 Bosh sahifa' }]
                ],
                resize_keyboard: true
            }
        };
        bot.sendMessage(chatId, 'Bosh sahifaga qaytdingiz. Gullar katalogidan tanlashingiz mumkin!', options);
    }
    // Boshqa matnli xabarlar bu yerda qayta ishlanmaydi (ular state yoki command handlerlarida)
});


// --- Advertisement Handlers (Admin Only) ---

bot.onText(/\/reklama/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (userId !== ADMIN_CHAT_ID) return; // Admin only

    // Check if already in ad process
    if (userStates[userId]?.state === AdvertisementStates.WAITING_FOR_CONTENT) {
         bot.sendMessage(chatId, "Siz allaqachon reklama yuborish jarayonidasiz. Avval uni bekor qiling yoki yakunlang.");
         return;
    }


    const cancelMarkup = {
        reply_markup: {
            keyboard: [[{ text: '❌ Bekor qilish' }]],
            resize_keyboard: true,
            one_time_keyboard: true
        }
    };
    bot.sendMessage(chatId,
        "Iltimos, reklama uchun xabarni (matn, rasm, video, hujjat) yuboring.\n" +
        "Bekor qilish uchun '❌ Bekor qilish' tugmasini bosing.",
        cancelMarkup
    );
    userStates[userId] = { state: AdvertisementStates.WAITING_FOR_CONTENT, data: {} };
});

// Handles ad content OR cancellation when in WAITING_FOR_CONTENT state
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (userId === ADMIN_CHAT_ID && userStates[userId]?.state === AdvertisementStates.WAITING_FOR_CONTENT) {

        if (msg.text === '❌ Bekor qilish') {
            delete userStates[userId];
            const mainMarkup = { // Get main menu markup
                 reply_markup: {
                     keyboard: [
                         [{ text: '🌸 Gullar katalogi', web_app: { url: WEB_APP_URL } }],
                         [{ text: '🏠 Bosh sahifa' }]
                     ],
                     resize_keyboard: true
                 }
             };
            bot.sendMessage(chatId, "Reklama yuborish bekor qilindi.", mainMarkup);
            return;
        }

        // Store ad content in state data
        const adStateData = userStates[userId].data;
        adStateData.contentType = msg.photo ? 'photo' : (msg.video ? 'video' : (msg.document ? 'document' : 'text'));
        adStateData.text = msg.text;
        adStateData.caption = msg.caption;
        adStateData.photoId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : null;
        adStateData.videoId = msg.video ? msg.video.file_id : null;
        adStateData.documentId = msg.document ? msg.document.file_id : null;

         if (activeUsers.size === 0) {
             delete userStates[userId];
             const mainMarkup = { /* ... */ }; // Define main menu markup again
             bot.sendMessage(chatId, "Hozirda faol foydalanuvchilar yo'q.", mainMarkup);
             return;
         }

        // Ask for confirmation
        const confirmMarkup = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: `✅ Ha (${activeUsers.size} kishi)`, callback_data: "confirm_ad" },
                        { text: "❌ Yo'q", callback_data: "cancel_ad" }
                    ]
                ]
            }
        };
        await bot.sendMessage(chatId, `Ushbu reklama ${activeUsers.size} ta faol foydalanuvchiga yuborilsinmi?`, confirmMarkup);
         // State remains WAITING_FOR_CONTENT, waiting for callback
    }
});

// Handles ad confirmation callback
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id; // Admin chat ID
    const userId = callbackQuery.from.id; // Admin user ID
    const data = callbackQuery.data;

    // Only admin and relevant ad confirmation callbacks
    if (userId === ADMIN_CHAT_ID && (data === 'confirm_ad' || data === 'cancel_ad')) {
        await bot.answerCallbackQuery(callbackQuery.id);

        const stateInfo = userStates[userId];

        // Edit the confirmation message (remove buttons)
         try {
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msg.message_id });
            const confirmText = data === 'confirm_ad' ? "✅ Yuborish tanlandi." : "❌ Bekor qilindi.";
            await bot.editMessageText(`${msg.text}\n\n---\n${confirmText}`, { chat_id: chatId, message_id: msg.message_id });
         } catch(editErr){
             console.warn("Could not edit ad confirmation message:", editErr.message);
         }


        // Check if we are in the correct state to process this
        if (!stateInfo || stateInfo.state !== AdvertisementStates.WAITING_FOR_CONTENT || !stateInfo.data.contentType) {
            console.warn(`Admin ${userId} pressed ${data}, but state is not correct or ad data is missing.`);
            await bot.sendMessage(chatId, "Xatolik: Reklama jarayoni topilmadi yoki kontent saqlanmagan.");
            delete userStates[userId]; // Clear inconsistent state
            // Restore main menu for admin
            const mainMarkup = { /* ... */ };
             await bot.sendMessage(chatId, "Asosiy menyu.", mainMarkup);
            return;
        }

        const adData = stateInfo.data; // Get the stored ad data
        delete userStates[userId]; // Clear state after handling confirmation

         // Restore main menu for admin
         const mainMarkup = {
             reply_markup: {
                 keyboard: [
                     [{ text: '🌸 Gullar katalogi', web_app: { url: WEB_APP_URL } }],
                     [{ text: '🏠 Bosh sahifa' }]
                 ],
                 resize_keyboard: true
             }
         };


        if (data === 'cancel_ad') {
            await bot.sendMessage(chatId, "Reklama yuborish bekor qilindi.", mainMarkup);
            return;
        }

        // --- Send Advertisement ---
         if (activeUsers.size === 0) {
             await bot.sendMessage(chatId, "Yuborish uchun faol foydalanuvchilar yo'q.", mainMarkup);
             return;
         }

        await bot.sendMessage(chatId, `⏳ Reklama ${activeUsers.size} foydalanuvchiga yuborilmoqda...`, mainMarkup);

        let sent = 0;
        let failed = 0;
        const usersToRemove = new Set(); // Use Set for efficient removal check

        const userList = Array.from(activeUsers); // Copy Set to Array for safe iteration

        for (const targetUserId of userList) {
             // Skip sending to admin self
             // if (targetUserId === ADMIN_CHAT_ID) continue;

            try {
                if (adData.contentType === 'text') {
                    await bot.sendMessage(targetUserId, adData.text);
                } else if (adData.contentType === 'photo' && adData.photoId) {
                    await bot.sendPhoto(targetUserId, adData.photoId, { caption: adData.caption });
                } else if (adData.contentType === 'video' && adData.videoId) {
                    await bot.sendVideo(targetUserId, adData.videoId, { caption: adData.caption });
                } else if (adData.contentType === 'document' && adData.documentId) {
                    await bot.sendDocument(targetUserId, adData.documentId, { caption: adData.caption });
                }
                sent++;
            } catch (error) {
                failed++;
                console.error(`Failed to send ad to user ${targetUserId}: ${error.message} (Code: ${error.code})`);

                // Check for common errors indicating inactive user
                if (error.code === 'ETELEGRAM') {
                     const errorMsg = error.message.toLowerCase();
                     if (errorMsg.includes('forbidden: bot was blocked by the user') ||
                         errorMsg.includes('chat not found') ||
                         errorMsg.includes('user is deactivated'))
                     {
                         usersToRemove.add(targetUserId);
                     } else if (errorMsg.includes('too many requests')) {
                          console.warn('Rate limit hit. Pausing for 1 second...');
                          await new Promise(resolve => setTimeout(resolve, 1100)); // Pause
                          // Optional: Retry logic could be added here, but be cautious
                     }
                }
            }
             // Small delay between messages to avoid hitting limits aggressively
             await new Promise(resolve => setTimeout(resolve, 60)); // 60ms delay (approx 16 messages/sec)
        }

        // Remove inactive users from the main activeUsers set
        usersToRemove.forEach(inactiveUserId => activeUsers.delete(inactiveUserId));

        // Report result to admin
        const resultMessage = `
✅ Reklama yuborish yakunlandi!
----------
Muvaffaqiyatli: ${sent}
Muvaffaqiyatsiz: ${failed}
${usersToRemove.size > 0 ? `Faol bo'lmaganlar o'chirildi: ${usersToRemove.size}` : ''}
Faol foydalanuvchilar soni: ${activeUsers.size}
        `.trim();
        await bot.sendMessage(chatId, resultMessage);
    }
});


// --- Register Other Handlers ---
function setupHandlers() {
    // Muhim: Handlerlar to'g'ri argumentlar bilan chaqirilishi kerak!
    registerLocationHandlers(bot, userData, userStates, WEB_APP_URL);
    registerDeliveryHandlers(bot, userData, userStates, ADMIN_CHAT_ID);
    registerPaymentHandlers(bot, userData, userStates, ADMIN_CHAT_ID, WEB_APP_URL);
    // Reklama handlerlari allaqachon main.js da joylashgan.
}

// --- Start the Bot ---
setupHandlers();
console.log('Bot is running and polling for updates!');

// --- Error Handling ---
bot.on('polling_error', (error) => {
    console.error(`Polling Error: ${error.code} - ${error.message}`);
    // Handle specific errors if needed (e.g., network issues)
});

bot.on('webhook_error', (error) => {
    console.error(`Webhook Error: ${error.code} - ${error.message}`);
});

bot.on('error', (error) => {
    console.error('General Bot Error:', error);
});

// Graceful shutdown (optional)
process.once('SIGINT', () => bot.stopPolling({ cancel: true }).then(() => console.log('Bot stopped polling via SIGINT')));
process.once('SIGTERM', () => bot.stopPolling({ cancel: true }).then(() => console.log('Bot stopped polling via SIGTERM')));