const User = require("../Model/user");

const sendPlayDemoOptions = async (ctx) => {
    const telegramId = ctx.from.id;
    
    // Find the user in the database
    const user = await User.findOne({ telegramId });

    if (!user) {
        // If the user isn't registered, prompt them to register
        return ctx.reply("🚫 You must register first. Please click below to register:", {
            reply_markup: {
                inline_keyboard: [[{ text: "🔐 Register", callback_data: "register" }]]
            }
        });
    }
    
    // If the user is registered, show the new game options (10 and 20 Birr)
    return ctx.reply("🎮 Game Choice:", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "10 Birr", web_app: { url: `https://bossbingo.netlify.app/?user=${telegramId}&game=10` } }],
                [{ text: "20 Birr", web_app: { url: `https://bossbingo.netlify.app/?user=${telegramId}&game=20` } }]
            ]
        }
    });
};


// Export the function so it can be called from the main handler
module.exports = {
    sendPlayDemoOptions
};