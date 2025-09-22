// handlers/manualDepositSceneHandler.js

const { Telegraf, Scenes, session } = require("telegraf");
const User = require("../Model/user");
const SmsMessage = require("../Model/SmsMessage");
const Deposit = require("../Model/Deposit");
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

// =================================================================
// ➡️ Manual Deposit Wizard Scene
// =================================================================
const manualDepositScene = new Scenes.WizardScene(
  "manualDeposit",

  // Step 1: Ask for deposit amount
  async (ctx) => {
    if (ctx.message?.text?.toLowerCase() === "/cancel" || ctx.message?.text?.toLowerCase() === "cancel") {
      await ctx.reply("❌ Manual deposit cancelled.");
      return ctx.scene.leave();
    }

    try {
      await userRateLimiter.consume(ctx.from.id);
      await globalRateLimiter.consume("global");
      await ctx.reply("💰 ለማስገባት የሚፈልጉትን መጠን ያስገቡ: (ለመውጣት /cancel )");
      return ctx.wizard.next();
    } catch (err) {
      if (err?.msBeforeNext) {
        await ctx.reply("⚠️ Too many requests. Please wait a moment before trying again.");
      } else {
        console.error("❌ Error entering manualDepositScene:", err.message);
        await ctx.reply("🚫 An error occurred. Please try again.");
      }
      return ctx.scene.leave();
    }
  },

  // Step 2: Receive amount and save
  async (ctx) => {
    if (ctx.message?.text?.toLowerCase() === "/cancel" || ctx.message?.text?.toLowerCase() === "cancel") {
      await ctx.reply("❌ Manual deposit cancelled.");
      return ctx.scene.leave();
    }

    const amount = parseFloat(ctx.message.text);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply("🚫 የተሳሳተ መጠን። እባክዎ ትክክለኛ ቁጥር ያስገቡ (ለምሳሌ፦ 100)። (ለመውጣት /cancel ይጻፉ)");
      return;
    }

    // Merge deposit amount into depositInProgress
    await User.findOneAndUpdate(
      { telegramId: ctx.from.id },
      { $set: { "depositInProgress.amount": amount } },
      { upsert: true, new: true }
    );

    await ctx.reply(
      `💰 የሚፈልጉት ${amount} ብር ለማስገባት ነው። እባክዎ የክፍያ ዘዴዎን ይምረጡ: (ለመውጣት /cancel ይጻፉ)`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: "CBE to CBE", callback_data: "payment_cbe" }],
            [{ text: "Telebirr To Telebirr", callback_data: "payment_telebirr" }],
          ],
        },
      }
    );

    return ctx.wizard.next();
  },

  // Step 3: Handle payment selection
  async (ctx) => {
    if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith("payment_")) {
      await ctx.answerCbQuery("Please use the buttons provided.");
      await ctx.reply("⚠️ Please select a payment method using the buttons. (Type /cancel to exit)");
      return;
    }

    const method = ctx.callbackQuery.data;
    await ctx.answerCbQuery();

    const user = await User.findOne({ telegramId: ctx.from.id });
    if (!user?.depositInProgress?.amount) {
      await ctx.reply("❌ No deposit amount found. Please start a new deposit using /deposit.");
      return ctx.scene.leave();
    }

    const amount = user.depositInProgress.amount;
    let depositType = "";
    let instructions = "";

     if (method === "payment_cbe") {
  depositType = "CBE";
  instructions = `
የኢትዮጵያ ንግድ ባንክ አካውንት

\`\`\`
1000454544246 
\`\`\`

\`\`\`
1. ከላይ ባለው የኢትዮጵያ ንግድ ባንክ አካውንት ${amount} ብር ያስገቡ

2. የምትልኩት የገንዘብ መጠን እና እዚ ላይ እንዲሞላልዎ የምታስገቡት የብር መጠን ተመሳሳይ መሆኑን እርግጠኛ ይሁኑ

3. ብሩን ስትልኩ የከፈላችሁበትን መረጃ የያዘ አጭር የጹሁፍ መልክት (sms) ከኢትዮጵያ ንግድ ባንክ ይደርሳችኋል

4. የደረሳችሁን አጭር የጹሁፍ መልክት (sms) ሙሉውን ኮፒ (copy) በማረግ ከታች ባለው የቴሌግራም የጹሁፍ ማስገቢያው ላይ ፔስት (paste) በማረግ ይላኩት

5. ብር ስትልኩ የምትጠቀሙት USSD (*889#) ከሆነ፣ ከUSSD (*889#) መጨረሻ ላይ "Complete" ሲያሳይ፣ 3 ቁጥርን በመጫን የትራንዛክሽን ቁጥሩን ያሳያል። ይህን ቁጥር ጽፎ ይቀመጡ
\`\`\`

🔔 ማሳሰቢያ:
- አጭር የጹሁፍ መልክት (sms) ካልደረሳቹ፣ የከፈላችሁበትን ደረሰኝ ከባንክ በመቀበል በማንኛውም ሰአት ትራንዛክሽን ቁጥሩን ቦቱ ላይ ማስገባት ትችላላቹ

- የክፍያ ችግር ካለ፣ [@luckybingos] ኤጀንቱን ማዋራት ይችላሉ፡፡  ለማቋረጥ /cancel

👉 የከፈለችሁበትን አጭር የጹሁፍ መልክት (sms) ወይም "FT" ብሎ የሚጀምረውን የትራንዛክሽን ቁጥር እዚ ላይ ያስገቡ 👇👇👇
`;
    } else if (method === "payment_telebirr") {
      depositType = "Telebirr";
      instructions = `
    📱 የቴሌብር አካውንት

    \`\`\`
    0930534417
    \`\`\`

    \`\`\`
    1. ከላይ ባለው የቴሌብር አካውንት ${amount} ብር ያስገቡ

    2. የምትልኩት የገንዘብ መጠን እና እዚ ላይ እንዲሞላልዎ የምታስገቡት የብር መጠን ተመሳሳይ መሆኑን እርግጠኛ ይሁኑ

    3. ብሩን ስትልኩ የከፈላችሁበትን መረጃ የያዘ አጭር የጹሁፍ መልክት (sms) ከቴሌብር ይደርሳችኋል

    4. የደረሳችሁን አጭር የጹሁፍ መልክት (sms) ሙሉውን ኮፒ (copy) በማረግ ከታች ባለው የቴሌግራም የጹሁፍ ማስገቢያው ላይ ፔስት (paste) በማረግ ይላኩት
    \`\`\`

    🔔 ማሳሰቢያ:
    - የክፍያ ችግር ካለ፣ [@luckybingos] ኤጀንቱን ማዋራት ይችላሉ፡፡ ለማቋረጥ /cancel

    👉 የከፈለችሁበትን አጭር የጹሁፍ መልክት (sms) እዚ ላይ ያስገቡ 👇👇👇
    `;
    }
    // Merge deposit method
    await User.findOneAndUpdate(
      { telegramId: ctx.from.id },
      { $set: { "depositInProgress.method": depositType } },
      { new: true }
    );

    await ctx.reply(instructions, { parse_mode: "Markdown" });
    return ctx.wizard.next();
  },

  // Step 4: Verify confirmation message
  async (ctx) => {
    if (ctx.message?.text?.toLowerCase() === "/cancel" || ctx.message?.text?.toLowerCase() === "cancel") {
      await ctx.reply("❌ Deposit cancelled.");
      return ctx.scene.leave();
    }

    const userMessage = ctx.message?.text || ctx.message?.caption;
    const telegramId = ctx.from.id;

    const user = await User.findOne({ telegramId });
    const depositInProgress = user?.depositInProgress;

    if (!user || !depositInProgress?.amount || !depositInProgress?.method) {
      await ctx.reply("❌ No deposit in progress. Start a new deposit using /deposit.");
      return ctx.scene.leave();
    }

    const claimedAmount = depositInProgress.amount;
    const depositType = depositInProgress.method;

    if (!userMessage) {
      await ctx.reply("❌ Please forward the SMS message correctly. (Type /cancel to exit)");
      return;
    }

    try {
      // Regex for transaction IDs
      const cbeRegex = /FT\s*([A-Z0-9]{10})/i;
      const telebirrRegex = /(?:transaction\s*number\s*is|የሂሳብ\s*እንቅስቃሴ\s*ቁጥር|Txn\s*ID|Reference\s*No)[^\w]*([A-Z0-9]{10})/i;

      let transactionId = null;
      if (cbeRegex.test(userMessage)) transactionId = userMessage.match(cbeRegex)[1];
      else if (telebirrRegex.test(userMessage)) transactionId = userMessage.match(telebirrRegex)[1];

      if (!transactionId) {
        await ctx.reply("🚫 Invalid message. Ensure it is the original CBE/Telebirr SMS. (Type /cancel to exit)");
        return ctx.scene.leave();
      }

      // Find matching SMS
      const matchingSms = await SmsMessage.findOne({
        status: "pending",
        message: { $regex: new RegExp(transactionId, "i") },
        message: { $regex: new RegExp(claimedAmount.toFixed(2).replace('.', '\\.'), "i") },
      });

      if (!matchingSms) {
        await ctx.reply("🚫 No matching deposit found. Ensure you forwarded the correct message. (Type /cancel to exit)");
        return ctx.scene.leave();
      }

      const balanceBefore = user.balance;
      const newBalance = balanceBefore + claimedAmount;

      // Save deposit
      await Deposit.create({
        userId: user._id,
        telegramId: user.telegramId,
        amount: claimedAmount,
        method: depositType,
        status: "approved",
        transactionId,
        smsMessageId: matchingSms._id,
        balanceBefore,
        balanceAfter: newBalance,
      });

      // Mark SMS processed
      matchingSms.status = "processed";
      await matchingSms.save();

      // Update user
      const updatedUser = await User.findOneAndUpdate(
        { telegramId },
        { balance: newBalance, $unset: { depositInProgress: "" } },
        { new: true }
      );

      await ctx.reply(
        `✅ Your deposit of ${claimedAmount} ETB has been approved! New balance: *${updatedUser.balance} ETB*`,
        { parse_mode: "Markdown" }
      );

    } catch (error) {
      if (error.code === 11000) {
        await ctx.reply("🚫 This transaction has already been processed.");
      } else {
        console.error("❌ Error processing manual deposit:", error);
        await ctx.reply("🚫 An error occurred while processing your deposit. Please try again.");
      }
    }

    return ctx.scene.leave();
  }
);

// =================================================================
// Stage and middleware
// =================================================================
const stage = new Scenes.Stage([manualDepositScene]);

module.exports = (bot) => {
  bot.use(session());
  bot.use(stage.middleware());
};
