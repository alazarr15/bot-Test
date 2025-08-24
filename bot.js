const { Telegraf } = require("telegraf");
const { botCommands } = require("./config/botCommands");

// Create bot instance
const bot = new Telegraf(process.env.BOT_TOKEN);

// ✅ Set Telegram menu commands
bot.telegram.setMyCommands(botCommands)
  .then(() => console.log("✅ Menu button commands set successfully!"))
  .catch(console.error);

// ✅ Register all commands except deposit (inline below)
require("./commands/register")(bot);
require("./commands/changeUsername")(bot);
require("./commands/playdemo")(bot);
require("./commands/balance")(bot);
require("./commands/withdraw")(bot)
require("./commands/deposit")(bot); 
require("./commands/invite")(bot);
require("./commands/support")(bot);
require("./commands/transferFunds")(bot);
require("./commands/start")(bot);
require("./commands/check_withdrwal")(bot);
require('./commands/transfer_history')(bot);

// ⭐ IMPORTANT: Register the scene handler (which applies session and stage middleware) FIRST
require("./handlers/manualDepositSceneHandler")(bot); // <--- THIS LINE MOVED UP

// ✅ Register event handlers except deposit action handler
require("./handlers/textHandler")(bot);
require("./handlers/contactHandler")(bot);
require("./handlers/callbackQueryHandler")(bot);


bot.catch((err, ctx) => {
  if (err.response && err.response.error_code === 403) {
    console.warn(`⚠️ Bot blocked by user or forbidden: chat_id=${ctx.chat?.id}`);
  } else {
    console.error(`❌ Unhandled error for update ${ctx.update.update_id}:`, err);
  }
});


module.exports = bot;
