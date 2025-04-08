// payment_handlers.js
const TelegramBot = require('node-telegram-bot-api');
const { sendOrderToAdmin } = require('./delivery_handlers'); // sendOrderToAdmin ni import qilish

// State ta'riflari (FSM o'rniga)
const PaymentStates = {
    WAITING_FOR_PAYMENT: 'waiting_for_payment',         // Karta tanlangandan keyin "To'lov qildim" kutiladi
    WAITING_FOR_CONFIRMATION: 'waiting_for_confirmation' // "To'lov qildim" bosilgandan keyin fayl kutiladi
};

/**
 * Helper function to determine delivery method from user data.
 * @param {object} userDataForUser - The data object for a specific user.
 * @returns {string} 'delivery' or 'pickup'.
 */
function getDeliveryMethod(userDataForUser) {
    if (!userDataForUser) return 'delivery'; // Default

    // Eng aniq manba 'delivery_type'
    if (userDataForUser.delivery_type) {
        return userDataForUser.delivery_type.toLowerCase() === 'pickup' ? 'pickup' : 'delivery';
    }

    // Boshqa variantlarni tekshirish (agar 'delivery_type' bo'lmasa)
    if (userDataForUser.delivery_method) {
         return userDataForUser.delivery_method.toLowerCase() === 'olib_ketish' ? 'pickup' : 'delivery';
    }
     if (userDataForUser.order?.delivery_method) {
          return userDataForUser.order.delivery_method.toLowerCase() === 'olib_ketish' ? 'pickup' : 'delivery';
     }
    // Agar hech qaysi topilmasa, lokatsiya borligiga qarab taxmin qilish
    if (userDataForUser.location) return 'delivery';

    // Default 'pickup' yoki 'delivery' bo'lishi mumkin, logikaga qarab
    return 'pickup'; // Masalan, agar lokatsiya yo'qsa olib ketish deb hisoblash
}

/**
 * Forwards payment confirmation (photo/document) to admin with action buttons.
 * @param {TelegramBot} bot - The bot instance.
 * @param {number} userId - The customer's user ID.
 * @param {TelegramBot.Message} message - The message containing the proof (photo/document).
 * @param {number} adminChatId - The admin's chat ID.
 * @param {object} userData - The object containing all users' data.
 */
async function forwardPaymentToAdmin(bot, userId, message, adminChatId, userData) {
    try {
        const user = userData[userId] || {};
        const userName = user.name || 'Noma\'lum';
        const userPhone = user.phone || 'Noma\'lum';
        const total = user.order?.total || 0;
        const formattedTotal = Number(total).toLocaleString('fr-FR').replace(/\s/g, ' ');

        const adminText = `
💳 <b>To'lov isboti qabul qilindi!</b>

👤 <b>Mijoz:</b> ${userName} (${userId})
📱 <b>Telefon:</b> ${userPhone}
💰 <b>Summa:</b> ${formattedTotal} so'm

Iltimos, quyidagi faylni tekshiring va to'lovni tasdiqlang yoki rad eting:
        `.trim();

        const adminMarkup = {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "✅ Tasdiqlash", callback_data: `approve_${userId}` },
                        { text: "❌ Rad etish", callback_data: `reject_${userId}` }
                    ]
                ]
            }
        };

        // 1. Avval matnni yuborish
        await bot.sendMessage(adminChatId, adminText, { parse_mode: "HTML" });

        // 2. Keyin faylni (rasm/dokument) tasdiqlash tugmalari bilan yuborish
        if (message.photo) {
            const fileId = message.photo[message.photo.length - 1].file_id;
            await bot.sendPhoto(adminChatId, fileId, { ...adminMarkup }); // Caption kerak emas, chunki alohida xabar yuborildi
        } else if (message.document) {
            const fileId = message.document.file_id;
            await bot.sendDocument(adminChatId, fileId, { ...adminMarkup });
        }

        // 3. Buyurtma tarkibini ham yuborish (ixtiyoriy, lekin foydali)
        if (user.order?.items) {
            let orderItems = "";
            user.order.items.forEach(item => {
                const name = item.name || 'Nomsiz mahsulot';
                const quantity = Number(item.quantity) || 0;
                const price = Number(item.price) || 0;
                const itemTotal = price * quantity;
                const formattedItemTotal = itemTotal.toLocaleString('fr-FR').replace(/\s/g, ' ');
                orderItems += `- ${name} x ${quantity} = ${formattedItemTotal} so'm\n`;
            });
            await bot.sendMessage(adminChatId, `🛒 <b>Buyurtma tarkibi:</b>\n${orderItems}`, { parse_mode: "HTML" });
        }

    } catch (error) {
        console.error(`Error forwarding payment proof to admin for user ${userId}:`, error);
        try {
            await bot.sendMessage(adminChatId, `❗️ Foydalanuvchi ${userId} uchun to'lov isbotini yuborishda xatolik: ${error.message}`);
        } catch (adminNotifyError) {
            console.error("Failed to notify admin about forwarding error:", adminNotifyError);
        }
    }
}


/**
 * Registers payment related handlers.
 * @param {TelegramBot} bot - The bot instance.
 * @param {object} userData - The object to store user data.
 * @param {object} userStates - The object to store user FSM-like states.
 * @param {number} ADMIN_CHAT_ID - Admin's chat ID.
 * @param {string} WEB_APP_URL - The URL of the main web app.
 */
function registerPaymentHandlers(bot, userData, userStates, ADMIN_CHAT_ID, WEB_APP_URL) {
    console.log('Registering payment handlers...');

    // --- To'lov Usulini Tanlash (Callback Query) ---
    bot.on('callback_query', async (callbackQuery) => {
        const msg = callbackQuery.message;
        const userId = callbackQuery.from.id;
        const data = callbackQuery.data;

        // Faqat payment_card yoki payment_cash va state da bo'lmasa
        if ((data === 'payment_card' || data === 'payment_cash') && !userStates[userId]) {
             await bot.answerCallbackQuery(callbackQuery.id);

             // Inline klaviaturani o'chirish
             try {
                 if(msg) {
                    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: msg.chat.id, message_id: msg.message_id });
                 }
             } catch (editError) {
                 console.warn(`Could not edit payment options markup msg ${msg?.message_id}: ${editError.message}`);
             }

            if (data === 'payment_card') {
                const cardNumber = "9860 0121 0891 8009"; // Karta raqami
                const totalAmount = userData[userId]?.order?.total || 0;
                const formattedTotal = Number(totalAmount).toLocaleString('fr-FR').replace(/\s/g, ' ');

                if (totalAmount <= 0) {
                     await bot.sendMessage(userId, "❗️ To'lov summasi noma'lum. Iltimos, buyurtmani qayta qiling yoki administratorga murojaat qiling.");
                     return; // Summa yo'q bo'lsa davom etmaslik
                }
// await bot.sendMessage(userId, "⬇️ Yaxshi!
                // State ni o'rnatish: to'lov faylini kutish
                 userStates[userId] = { state: PaymentStates.WAITING_FOR_PAYMENT, data: { payment_type: 'card' } };

                const paymentDetailsMarkup = {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ To'lov qildim", callback_data: "payment_done" }]
                        ]
                    }
                };

                const messageText = `
💳 <b>To'lov uchun ma'lumot:</b>

📌 <b>Karta raqami:</b> <code>${cardNumber}</code>
   <i>(Ustiga bosing, nusxa olinadi)</i>

💰 <b>To'lov summasi:</b> ${formattedTotal} so'm

⚠️ Iltimos, yuqoridagi kartaga to'lovni amalga oshirib, <b>"✅ To'lov qildim"</b> tugmasini bosing. Keyin to'lovni tasdiqlovchi <b>skrinshot</b> yoki <b>PDF chekni</b> yuboring.
                `.trim();

                await bot.sendMessage(userId, messageText, {
                    parse_mode: "HTML",
                    ...paymentDetailsMarkup
                });

            } else if (data === 'payment_cash') {
                // Naqd pul tanlandi. State o'rnatilmaydi.

                const mainMenuMarkup = {
                    reply_markup: {
                        keyboard: [
                            [{ text: '🌸 Gullar katalogi', web_app: { url: WEB_APP_URL } }],
                            [{ text: '🏠 Bosh sahifa' }]
                        ],
                        resize_keyboard: true
                    }
                };

                const userName = userData[userId]?.name || 'Mijoz';
                const messageText = `
✅ Hurmatli ${userName}, buyurtmangiz qabul qilindi!

💰 To'lovni buyurtmani olib ketish jarayonida <b>naqd pul</b> orqali amalga oshirasiz.

📞 Tez orada siz bilan bog'lanamiz. Savollar uchun: +998 94 777 98 91
                `.trim();

                await bot.sendMessage(userId, messageText, {
                    parse_mode: "HTML",
                    ...mainMenuMarkup // Asosiy menyuni ko'rsatish
                });

                // Buyurtmani adminga yuborish
                if (userData[userId]?.order) {
                    const deliveryMethod = getDeliveryMethod(userData[userId]);
                    await sendOrderToAdmin(bot, userId, deliveryMethod, userData, ADMIN_CHAT_ID, 'cash');
                     // Buyurtma yuborilgandan keyin userData dan order ni tozalash mumkin (ixtiyoriy)
                     // delete userData[userId].order;
                     // delete userData[userId].delivery_type;
                     // delete userData[userId].location;
                } else {
                    console.error(`Cannot send cash order to admin for ${userId}, order data missing.`);
                    await bot.sendMessage(ADMIN_CHAT_ID, `⚠️ Foydalanuvchi ${userId} naqd to'lovni tanladi, lekin buyurtma ma'lumoti topilmadi!`);
                }
            }
        }

        // --- "To'lov qildim" Tugmasi Bosilganda ---
        else if (data === 'payment_done' && userStates[userId]?.state === PaymentStates.WAITING_FOR_PAYMENT) {
             await bot.answerCallbackQuery(callbackQuery.id);

             // Inline klaviaturani olib tashlash
              try {
                 if(msg) {
                     await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: msg.chat.id, message_id: msg.message_id });
                 }
              } catch(editError){
                 console.warn(`Could not edit payment_done markup msg ${msg?.message_id}: ${editError.message}`);
              }


             // State ni o'zgartirish: fayl kutish
             userStates[userId].state = PaymentStates.WAITING_FOR_CONFIRMATION;

             await bot.sendMessage(userId, "⬇️ Yaxshi! Endi to'lovni tasdiqlovchi <b>skrinshot</b> yoki <b>PDF faylni</b> shu chatga yuboring.", { parse_mode: "HTML" });

        }

        // --- Admin To'lovni Tasdiqlash/Rad Etish ---
        else if ((data.startsWith('approve_') || data.startsWith('reject_')) && callbackQuery.from.id === ADMIN_CHAT_ID) {
             await bot.answerCallbackQuery(callbackQuery.id);
             const [action, targetUserIdStr] = data.split('_');
             const targetUserId = parseInt(targetUserIdStr, 10);

             if (isNaN(targetUserId)) {
                 await bot.sendMessage(ADMIN_CHAT_ID, "❗️ Xatolik: Foydalanuvchi ID si noto'g'ri.");
                 return;
             }

             // Admin xabaridagi tugmalarni o'chirish
              try {
                 if(msg) {
                     await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: msg.chat.id, message_id: msg.message_id });
                 }
              } catch(editError){
                  console.warn(`Could not edit admin confirmation markup msg ${msg?.message_id}: ${editError.message}`);
              }

             const targetUserData = userData[targetUserId];
             if (!targetUserData || !targetUserData.order) {
                 await bot.sendMessage(ADMIN_CHAT_ID, `⚠️ Xatolik: Foydalanuvchi ${targetUserId} uchun buyurtma ma'lumotlari topilmadi.`);
                 // Optionally try to find user data by ID only if needed for notification
                  try {
                     await bot.sendMessage(targetUserId, "❗️ Kechirasiz, buyurtma ma'lumotlaringiz bilan bog'liq muammo yuz berdi. Iltimos, administrator bilan bog'laning.");
                 } catch (userNotifyError){
                     console.error("Could not notify user about missing data", userNotifyError.message);
                 }
                 return;
             }

             if (action === 'approve') {
                 targetUserData.payment_verified = true; // Tasdiqlanganlikni belgilash

                 // Mijozga xabar yuborish
                 await bot.sendMessage(targetUserId,
                     "✅ To'lovingiz muvaffaqiyatli tasdiqlandi!\n\n" +
                     "📦 Buyurtmangiz tayyorlanmoqda. Tez orada yetkazib berish uchun siz bilan bog'lanamiz.\n\n" +
                     "📞 Qo'shimcha savollar uchun: +998 94 777 98 91"
                 );

                 // Adminga xabar yuborish
                 await bot.sendMessage(ADMIN_CHAT_ID, `✅ Foydalanuvchi ${targetUserId} uchun to'lov tasdiqlandi.`);

                 // Buyurtmani adminga TO'LIQ (tasdiqlangan to'lov bilan) yuborish
                 const deliveryMethod = getDeliveryMethod(targetUserData);
                 await sendOrderToAdmin(bot, targetUserId, deliveryMethod, userData, ADMIN_CHAT_ID, 'card_verified'); // 'card_verified' statusi bilan

                  // Buyurtma tugagach ma'lumotlarni tozalash (ixtiyoriy)
                 // delete userData[targetUserId].order;
                 // delete userData[targetUserId].payment_proof;
                 // ...boshqa vaqtinchalik ma'lumotlar

             } else if (action === 'reject') {
                 targetUserData.payment_verified = false;
                 delete targetUserData.payment_proof; // Rad etilgan bo'lsa, isbotni olib tashlash

                 // Mijozga xabar va qayta urinish tugmalari
                 const retryMarkup = {
                     reply_markup: {
                         inline_keyboard: [
                             // [{ text: "🔄 To'lovni qayta yuborish", callback_data: "payment_retry_proof" }], // Faylni qayta so'rash
                             [{ text: "💳 Boshqa karta / Qayta urinish", callback_data: "payment_card" }], // Karta ma'lumotlarini qayta ko'rsatish
                             [{ text: "❌ Buyurtmani bekor qilish", callback_data: "payment_cancel" }]
                         ]
                     }
                 };
                 await bot.sendMessage(targetUserId,
                     "❌ Kechirasiz, yuborgan to'lov isbotingiz tasdiqlanmadi.\n\n" +
                     "Sabablar bo'lishi mumkin:\n" +
                     "- Noto'g'ri summa\n" +
                     "- Noto'g'ri karta raqami\n" +
                     "- Isbot fayli tushunarsiz\n\n" +
                     "Iltimos, qayta tekshiring yoki buyurtmani bekor qiling.",
                     retryMarkup
                 );

                 // Adminga xabar
                 await bot.sendMessage(ADMIN_CHAT_ID, `❌ Foydalanuvchi ${targetUserId} uchun to'lov rad etildi.`);
             }
        }

         // --- Foydalanuvchi To'lovni Bekor Qilishi ---
         else if (data === 'payment_cancel' && !userStates[userId]) { // Faqat state da bo'lmasa
             await bot.answerCallbackQuery(callbackQuery.id);

              // Inline klaviaturani o'chirish
               try {
                  if(msg) {
                     await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: msg.chat.id, message_id: msg.message_id });
                  }
               } catch (editError) {
                   console.warn(`Could not edit payment cancel markup msg ${msg?.message_id}: ${editError.message}`);
               }

             // Bosh menyuga qaytish
             const mainMenuMarkup = {
                 reply_markup: {
                     keyboard: [
                         [{ text: '🌸 Gullar katalogi', web_app: { url: WEB_APP_URL } }],
                         [{ text: '🏠 Bosh sahifa' }]
                     ],
                     resize_keyboard: true
                 }
             };

             await bot.sendMessage(userId, "Buyurtma bekor qilindi. Bosh sahifaga qaytdingiz.", mainMenuMarkup);

             // Foydalanuvchi ma'lumotlarini tozalash (buyurtma va h.k.)
             if (userData[userId]) {
                  delete userData[userId].order;
                  delete userData[userId].payment_proof;
                  delete userData[userId].delivery_type;
                  delete userData[userId].location;
                  // Agar boshqa vaqtinchalik ma'lumotlar bo'lsa, ularni ham o'chirish
             }
             if (userStates[userId]) {
                 delete userStates[userId]; // State ni ham tozalash
             }
        }

         // --- Qayta urinish (payment_retry_proof - Hozircha ishlatilmayapti) ---
         // else if (data === 'payment_retry_proof' && !userStates[userId]) {
         //     await bot.answerCallbackQuery(callbackQuery.id);
         //     // State ni qayta o'rnatish
         //     userStates[userId] = { state: PaymentStates.WAITING_FOR_CONFIRMATION, data: { ...(userStates[userId]?.data || {}), payment_type: 'card' } };
         //     await bot.sendMessage(userId, "Iltimos, to'lovni tasdiqlovchi yangi skrinshot yoki PDF faylni yuboring.");
         // }

    }); // End of callback_query handler

    // --- To'lov Tasdiqlovchi Faylni Qabul Qilish (Message Handler) ---
    bot.on('message', async (msg) => {
        const userId = msg.from.id;

        // Faqat kerakli state da va rasm/dokument bo'lsa ishlaydi
        if (userStates[userId]?.state === PaymentStates.WAITING_FOR_CONFIRMATION && (msg.photo || msg.document)) {

            // Faylni userData ga saqlash
            if (!userData[userId]) userData[userId] = {};
            const fileId = msg.photo ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;
            const fileType = msg.photo ? 'photo' : 'document';
            userData[userId].payment_proof = { type: fileType, file_id: fileId };

            // State ni tugatish
            delete userStates[userId];

            // Faylni adminga yuborish
            await forwardPaymentToAdmin(bot, userId, msg, ADMIN_CHAT_ID, userData);

            // Foydalanuvchiga tasdiq xabarini va asosiy menyuni yuborish
            const mainMenuMarkup = {
                reply_markup: {
                    keyboard: [
                        [{ text: '🌸 Gullar katalogi', web_app: { url: WEB_APP_URL } }],
                        [{ text: '🏠 Bosh sahifa' }]
                    ],
                    resize_keyboard: true
                }
            };

            await bot.sendMessage(userId,
                "✅ Rahmat! To'lov isbotingiz qabul qilindi.\n\n" +
                "⏳ Administratorlarimiz tez orada uni tekshirib, sizga xabar berishadi.",
                mainMenuMarkup // Asosiy menyuni ko'rsatish
            );
        }
        // Agar state da bo'lsa-yu, lekin fayl emas, matn yuborsa (ixtiyoriy)
        else if (userStates[userId]?.state === PaymentStates.WAITING_FOR_CONFIRMATION && msg.text) {
             await bot.sendMessage(userId, "❗️ Iltimos, matn o'rniga to'lovni tasdiqlovchi <b>rasm</b> yoki <b>PDF faylni</b> yuboring.", { parse_mode: "HTML"});
        }

    }); // End of message handler
}

module.exports = registerPaymentHandlers; // Eksport qilish