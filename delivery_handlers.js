// delivery_handlers.js
const TelegramBot = require('node-telegram-bot-api');

/**
 * Formats and sends order details to the admin.
 * @param {TelegramBot} bot - The bot instance.
 * @param {number} userId - The customer's user ID.
 * @param {string} deliveryType - 'delivery' or 'pickup'.
 * @param {object} userData - The object containing all users' data.
 * @param {number} adminChatId - The admin's chat ID.
 * @param {string|null} [paymentType=null] - 'cash', 'card_verified', etc.
 */
async function sendOrderToAdmin(bot, userId, deliveryType, userData, adminChatId, paymentType = null) {
    try {
        const user = userData[userId];
        if (!user || !user.order) {
            console.error(`sendOrderToAdmin: Missing order data for user ${userId}`);
            return;
        }

        const order = user.order;
        if (!order.items || !Array.isArray(order.items)) {
            console.error(`sendOrderToAdmin: Order format error: 'items' key missing or not an array for user ${userId}`);
            return;
        }

        let orderItems = "";
        let calculatedTotal = 0;
        order.items.forEach(item => {
            const name = item.name || 'Nomsiz mahsulot';
            const quantity = Number(item.quantity) || 0;
            const price = Number(item.price) || 0;
            const itemTotal = price * quantity;
            calculatedTotal += itemTotal;
            const formattedItemTotal = itemTotal.toLocaleString('fr-FR').replace(/\s/g, ' ');
            orderItems += `- ${name} x ${quantity} = ${formattedItemTotal} so'm\n`;
        });

        const total = Number(order.total) || calculatedTotal;
        const formattedTotal = total.toLocaleString('fr-FR').replace(/\s/g, ' ');

        const deliveryInfo = deliveryType === "delivery" ? "🚚 <b>Yetkazib berish</b>" : "🏃 <b>Olib ketish</b>";

        let paymentInfo = "";
        if (paymentType) {
            if (paymentType === "cash") {
                paymentInfo = "💵 <b>To'lov: Naqd pul</b>";
            } else if (paymentType === "card_verified") {
                paymentInfo = "💳 <b>To'lov: Karta orqali (tasdiqlangan)</b>";
            }
        }

        const userName = user.name || 'Kiritilmagan';
        const userPhone = user.phone || 'Kiritilmagan';

        const orderMessage = `
🌸 <b>Yangi gul buyurtmasi qabul qilindi!</b>

👤 <b>Mijoz ma'lumotlari:</b>
Ism: ${userName}
Telefon: ${userPhone}

🛒 <b>Buyurtma tarkibi:</b>
${orderItems}
💰 <b>Jami summa:</b> ${formattedTotal} so'm

${deliveryInfo}
${paymentInfo ? `${paymentInfo}` : ''}
        `.trim();

        // Asosiy buyurtma xabarini yuborish
        await bot.sendMessage(adminChatId, orderMessage, { parse_mode: "HTML" });

        // Agar yetkazib berish bo'lsa, lokatsiyani yuborish
        if (deliveryType === "delivery" && user.location) {
            const latitude = user.location.latitude;
            const longitude = user.location.longitude;
            const locationCaption = `📍 Mijoz lokatsiyasi\nMijoz: ${userName}\nTelefon: ${userPhone}`;

            await bot.sendLocation(adminChatId, latitude, longitude);
            // Lokatsiyadan keyin qo'shimcha ma'lumotni yuborish
            await bot.sendMessage(adminChatId, locationCaption);
        }

        // Agar to'lov tasdiqlangan karta bo'lsa va isbot bo'lsa, uni yuborish
        // Bu logikani payment_handlers.js dagi admin tasdiqlagandan keyin chaqiriladigan joyga ko'chirish kerak.
        // Chunki bu funksiya naqd pul yoki admin tasdiqlashidan keyin chaqiriladi.
        // Hozircha shartni qoldiramiz, lekin payment_handlers da sendOrderToAdmin chaqirilganda payment_proof yuborilmaydi.
        // if (paymentType === "card_verified" && user.payment_proof) {
        //     const proof = user.payment_proof;
        //     const proofCaption = `💳 To'lov isboti (Tasdiqlangan)\nMijoz: ${userName}\nTelefon: ${userPhone}`;
        //
        //     if (proof.type === 'photo' && proof.file_id) {
        //         await bot.sendPhoto(adminChatId, proof.file_id, { caption: proofCaption });
        //     } else if (proof.type === 'document' && proof.file_id) {
        //         await bot.sendDocument(adminChatId, proof.file_id, { caption: proofCaption });
        //     }
        // }

    } catch (error) {
        console.error(`Error in sendOrderToAdmin for user ${userId}:`, error);
        try {
            await bot.sendMessage(adminChatId, `❗️ Buyurtma #${userId} ma'lumotlarini yuborishda xatolik yuz berdi: ${error.message}`);
        } catch (adminNotifyError) {
            console.error("Failed to notify admin about the error:", adminNotifyError);
        }
    }
}

/**
 * Registers delivery option selection handlers.
 * @param {TelegramBot} bot - The bot instance.
 * @param {object} userData - The object to store user data.
 * @param {object} userStates - The object to store user FSM-like states.
 * @param {number} ADMIN_CHAT_ID - Admin's chat ID.
 */
function registerDeliveryHandlers(bot, userData, userStates, ADMIN_CHAT_ID) { // userStates qo'shildi
    console.log('Registering delivery handlers...');

    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const userId = callbackQuery.from.id;
        const data = callbackQuery.data;

        // Faqat delivery/pickup callbacklari va foydalanuvchi state da bo'lmasa
        if ((data === 'delivery' || data === 'pickup') && !userStates[userId]) {
            await bot.answerCallbackQuery(callbackQuery.id);

            if (!userData[userId]) {
                userData[userId] = {};
            }
             // Eski inline klaviaturani o'chirish
             try {
                if (msg) {
                    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: msg.chat.id, message_id: msg.message_id });
                     // Optional: Edit message text to confirm selection
                     // const confirmationText = data === 'delivery' ? "Yetkazib berish tanlandi." : "Olib ketish tanlandi.";
                     // await bot.editMessageText(`${msg.text}\n\n---\n${confirmationText}`, { chat_id: msg.chat.id, message_id: msg.message_id });
                }
             } catch (editError) {
                 console.warn(`Could not edit reply markup for delivery choice msg ${msg?.message_id}: ${editError.message}`);
             }

            if (data === 'delivery') {
                userData[userId]['delivery_type'] = 'delivery';

                const locationKeyboard = {
                    reply_markup: {
                        keyboard: [
                            [{ text: '📍 Lokatsiyani yuborish', request_location: true }]
                        ],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                };

                await bot.sendMessage(
                    userId,
                    "Iltimos, yetkazib berish uchun manzilingizni yuboring (Lokatsiya tugmasini bosing):",
                    locationKeyboard
                );

            } else if (data === 'pickup') {
                userData[userId]['delivery_type'] = 'pickup';

                const pickupMessage = `
🏠 <b>Gul do'konimiz manzili:</b>

📍 <b>Manzil:</b> Toshkent shahri, Chilonzor tumani, 19-kvartal, 27-uy
⏰ <b>Ish vaqti:</b> 09:00 - 20:00

🌸 Buyurtmangizni olish uchun do'konimizga tashrif buyuring. Sizni kutamiz! 😊
                `.trim();

                await bot.sendMessage(userId, pickupMessage, { parse_mode: "HTML" });

                const paymentMarkup = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "💳 Karta orqali", callback_data: "payment_card" },
                                { text: "💵 Naqd pul", callback_data: "payment_cash" }
                            ]
                        ]
                    }
                };

                await bot.sendMessage(
                    userId,
                    "Iltimos, to'lov usulini tanlang:",
                    paymentMarkup
                );
            }
        }
    });
}

// Eksport qilish
module.exports = {
    registerDeliveryHandlers,
    sendOrderToAdmin
};