// location_handlers.js
const TelegramBot = require('node-telegram-bot-api'); // Agar alohida ishlatilsa

/**
 * Registers location and web app data handlers.
 * @param {TelegramBot} bot - The bot instance.
 * @param {object} userData - The object to store user data.
 * @param {object} userStates - The object to store user FSM-like states.
 * @param {string} WEB_APP_URL - The URL of the main web app.
 */
function registerLocationHandlers(bot, userData, userStates, WEB_APP_URL) { // userStates va WEB_APP_URL qo'shildi
    console.log('Registering location handlers...');

    // --- Web App Data Handler (Buyurtma ma'lumotlarini WebApp dan olish) ---
    bot.on('message', async (msg) => {
        // Faqat web_app_data bo'lsa va foydalanuvchi state da bo'lmasa ishlaydi
        if (msg.web_app_data && !userStates[msg.from.id]) {
            const chatId = msg.chat.id;
            const userId = msg.from.id;

            try {
                const data = JSON.parse(msg.web_app_data.data);
                console.log(`Received Web App data from ${userId}:`, data);

                // Foydalanuvchi ma'lumotlarini saqlash (buyurtma, ism, telefon)
                // Eski ma'lumotlarni saqlab qolgan holda yangilash
                userData[userId] = {
                    ...(userData[userId] || {}), // Eski ma'lumotlarni saqlash
                    order: data,
                    name: data.name || userData[userId]?.name || '', // Mavjud bo'lsa ustiga yozmaslik yoki default
                    phone: data.phone || userData[userId]?.phone || '' // Mavjud bo'lsa ustiga yozmaslik yoki default
                };

                // Yetkazib berish usulini tanlash uchun inline klaviatura
                const deliveryOptionsMarkup = {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "🚚 Yetkazib berish", callback_data: "delivery" },
                                { text: "🏃 Olib ketish", callback_data: "pickup" }
                            ]
                        ]
                    }
                };

                await bot.sendMessage(
                    chatId,
                    "✅ Buyurtma ro'yxati qabul qilindi!\nIltimos, yetkazib berish yoki olib ketish usulini tanlang:",
                    deliveryOptionsMarkup
                );

            } catch (error) {
                console.error(`Error processing web app data for user ${userId}:`, error);
                await bot.sendMessage(chatId, "❌ Buyurtma ma'lumotlarini qayta ishlashda xatolik yuz berdi. Iltimos, qaytadan urinib ko'ring yoki administratorga murojaat qiling.");
            }
        }
    });

    // --- Location Handler ---
    bot.on('location', async (msg) => {
        const chatId = msg.chat.id;
        const userId = msg.from.id;

        // Faqat state da bo'lmaganlar uchun (masalan, to'lovni kutmayotganlar)
        // Yoki aniq bir state kerak bo'lsa (masalan 'waiting_for_location') tekshirish mumkin
        // Hozirgi logikada lokatsiya 'delivery' tanlangandan keyin kutiladi
         if (!userStates[userId] || userData[userId]?.delivery_type === 'delivery') { // Faqat yetkazib berish tanlangan bo'lsa

            const latitude = msg.location.latitude;
            const longitude = msg.location.longitude;

            console.log(`Received location from ${userId}:`, msg.location);

            // Foydalanuvchi ma'lumotlariga lokatsiyani saqlash
            if (!userData[userId]) {
                userData[userId] = {}; // Agar user birinchi marta lokatsiya yuborsa
            }
            userData[userId].location = { latitude, longitude };

            // Faqat 'delivery' tanlangan bo'lsagina to'lov tugmasini ko'rsatamiz
            if (userData[userId]?.delivery_type === 'delivery') {
                 // Karta orqali to'lov uchun inline klaviatura
                 const paymentMarkup = {
                     reply_markup: {
                         inline_keyboard: [
                            //  [{ text: "💳 Karta orqali", callback_data: "payment_card" }], // Faqat karta
                             // Agar naqd pul ham mumkin bo'lsa:
                              [
                                { text: "💳 Karta orqali", callback_data: "payment_card" },
                                // Yetkazib berishda naqd pul varianti yo'q edi python kodda, lekin kerak bo'lsa qo'shish mumkin
                                // { text: "💵 Naqd pul (yetkazganda)", callback_data: "payment_cash_delivery" }
                              ]
                         ]
                     }
                 };

                 // Asosiy menyu klaviaturasini olib tashlash (agar ochiq bo'lsa)
                 await bot.sendMessage(userId, "📍 Lokatsiyangiz qabul qilindi!", { reply_markup: { remove_keyboard: true } });

                 await bot.sendMessage(
                    userId,
                     "Iltimos, to'lov usulini tanlang:",
                     paymentMarkup
                 );
            } else {
                 // Agar delivery_type aniqlanmagan bo'lsa (bu holat bo'lmasligi kerak)
                  await bot.sendMessage(userId, "📍 Lokatsiyangiz qabul qilindi. Buyurtmani yakunlash uchun avval yetkazib berish usulini tanlang.");
            }

         } else {
            console.log(`Location received from user ${userId} but they are in state ${userStates[userId]?.state} or delivery type is not 'delivery'. Ignoring.`);
            // State da bo'lsa yoki 'pickup' tanlangan bo'lsa, lokatsiyani qabul qilmaymiz
            // await bot.sendMessage(chatId, "Lokatsiya hozir kutilmayapti.");
         }
    });
}

module.exports = registerLocationHandlers; // Eksport qilish