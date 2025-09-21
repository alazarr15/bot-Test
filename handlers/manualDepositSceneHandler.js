// handlers/manualDepositSceneHandler.js

// Import necessary Telegraf modules for scene management
const { Telegraf, Scenes, session } = require("telegraf");
const User = require("../Model/user"); // Import your User model
const SmsMessage = require("../Model/SmsMessage"); // Import your SMS message model
const Deposit = require("../Model/Deposit"); // ✅ Import your final Deposit model
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

// ❌ The old placeholder "DepositRequest" object has been completely removed.

// =================================================================
// ➡️ Define the Manual Deposit Scene (Wizard Scene)
// =================================================================

const manualDepositScene = new Scenes.WizardScene(
  "manualDeposit", // unique ID for the scene

  // Step 1: Ask for the amount (No changes needed)
  async (ctx) => {
    if (ctx.message && (ctx.message.text === "/cancel" || ctx.message.text.toLowerCase() === "cancel")) {
      await ctx.reply("❌ Manual deposit cancelled.");
      return ctx.scene.leave();
    }
    try {
      await userRateLimiter.consume(ctx.from.id);
      await globalRateLimiter.consume("global");
      await ctx.reply("💰 ለማስገባት የሚፈልጉትን መጠን ያስገቡ: (ለመውጣት /cancel )");
      return ctx.wizard.next();
    } catch (err) {
      if (err && err.msBeforeNext) {
        await ctx.reply("⚠️ Too many requests. Please wait a moment before trying again.");
      } else {
        console.error("❌ Error entering manualDepositScene:", err.message);
        await ctx.reply("🚫 An error occurred. Please try again.");
      }
      return ctx.scene.leave();
    }
  },

  // Step 2: Receive amount and ask for payment method (No changes needed)
  async (ctx) => {
    if (ctx.message && (ctx.message.text === "/cancel" || ctx.message.text.toLowerCase() === "cancel")) {
      await ctx.reply("❌ Manual deposit cancelled.");
      return ctx.scene.leave();
    }
    const amount = parseFloat(ctx.message.text);
    if (isNaN(amount) || amount <= 0) {
      await ctx.reply("🚫 የተሳሳተ መጠን። እባክዎ ትክክለኛ ቁጥር ያስገቡ (ለምሳሌ፦ 100)። (ለመውጣት /cancel ይጻፉ)");
      return;
    }
    ctx.wizard.state.depositAmount = amount;
    await ctx.reply(`💰 የሚፈልጉት ${amount} ብር ለማስገባት ነው። እባክዎ የክፍያ ዘዴዎን ይምረጡ: (ለመውጣት /cancel ይጻፉ)`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "CBE to CBE", callback_data: "payment_cbe" }],
          [{ text: "Telebirr To Telebirr", callback_data: "payment_telebirr" }]
        ],
      },
    });
    return ctx.wizard.next();
  },

  // Step 3: Handle payment selection and provide instructions
  async (ctx) => {
    if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('payment_')) {
      await ctx.reply("Please use the buttons provided to select a payment method. (Type /cancel to exit)");
      return;
    }
    const method = ctx.callbackQuery.data;
    const amount = ctx.wizard.state.depositAmount;
    let instructions = "";
    let depositType = "";

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
      depositType = "ቴሌብር";
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

    // ✅ CRITICAL FIX: Save the deposit type to the scene's state
    ctx.wizard.state.depositType = depositType;

    await ctx.answerCbQuery();
    await ctx.reply(instructions, { parse_mode: "Markdown" });

    // ❌ REMOVED: The old call to DepositRequest.create() is gone.
    
    return ctx.wizard.next();
  },

  // Step 4: Receive and verify the user's confirmation message
  async (ctx) => {
    if (ctx.message && (ctx.message.text === "/cancel" || ctx.message.text.toLowerCase() === "cancel")) {
      await ctx.reply("❌ deposit cancelled.");
      return ctx.scene.leave();
    }
    const userMessage = ctx.message?.text || ctx.message?.caption;
    const telegramId = ctx.from.id;
    const claimedAmount = ctx.wizard.state.depositAmount;

    if (!userMessage) {
      await ctx.reply("❌ Please try forwarding the message again. (Type /cancel to exit)");
      return;
    }

    try {
      const cbeRegex = /(FT[A-Z0-9]{10})/i;
      const telebirrRegex = /(?:transaction number is|የሂሳብ እንቅስቃሴ ቁጥርዎ|Lakkoofsi sochii maallaqaa keessan|ቁፅሪ ሒሳብ ዝተንቀሳቀሰ|lambarka hawulgalkaaguna waa)\s*([A-Z0-9]{10})\'?/i;
      let transactionId = null;
      const cbeMatch = userMessage.match(cbeRegex);
      const telebirrMatch = userMessage.match(telebirrRegex);
      if (cbeMatch && cbeMatch[1]) {
        transactionId = cbeMatch[1];
      } else if (telebirrMatch && telebirrMatch[1]) {
        transactionId = telebirrMatch[1];
      }

      if (!transactionId) {
        await ctx.reply("🚫 የገለበጡት መልእክት ትክክለኛ የCBE ወይም የቴሌብር የግብይት መለያ አልያዘም። እባክዎ ደግመው ይሞክሩ። (ለመውጣት /cancel ይጻፉ)");
        return ctx.scene.leave();
      }
      console.log(`Attempting to match transaction ID: ${transactionId}`);

      const matchingSms = await SmsMessage.findOne({
        status: "pending",
        $and: [
          { message: { $regex: new RegExp(transactionId, "i") } },
          { message: { $regex: new RegExp(claimedAmount.toFixed(2).replace('.', '\\.'), "i") } }
        ]
      });

      if (matchingSms) {
        // ❌ REMOVED: The old call to DepositRequest.update() is gone.
        
        const user = await User.findOne({ telegramId });
        if (user) {
          const balanceBefore = user.balance;
          const newBalance = balanceBefore + claimedAmount;

          // 1. Create the detailed deposit record for your dashboard
          await Deposit.create({
            userId: user._id,
            telegramId: user.telegramId,
            amount: claimedAmount,
            method: ctx.wizard.state.depositType, // Now this will work correctly
            status: 'approved',
            transactionId: transactionId,
            smsMessageId: matchingSms._id,
            balanceBefore: balanceBefore,
            balanceAfter: newBalance,
          });
          
          // 2. Mark the SMS as processed to prevent reuse
          matchingSms.status = "processed";
          await matchingSms.save();
          
          // 3. Update the user's balance
          const updatedUser = await User.findOneAndUpdate(
            { telegramId },
            { $inc: { balance: claimedAmount } },
            { new: true }
          );

          await ctx.reply(`✅ Your deposit of ${claimedAmount} ETB has been successfully approved! Your new balance is: *${updatedUser.balance} ETB*.`, { parse_mode: 'Markdown' });
        } else {
          await ctx.reply("✅ Your deposit has been approved, but we couldn't find your user account to update the balance. Please contact support.");
        }
      } else {
        await ctx.reply("🚫 No matching deposit found. Please make sure you forwarded the correct and original confirmation message. If you believe this is an error, please contact support. (Type /cancel to exit)");
      }
    } catch (error) {
       if (error.code === 11000) { // Handles duplicate transactionId error
            await ctx.reply("🚫 This transaction has already been processed.");
        } else {
            console.error("❌ Error processing manual deposit message:", error);
            await ctx.reply("🚫 An error occurred while processing your request. Please try again or contact support.");
        }
    }

    return ctx.scene.leave();
  }
);

// Create a stage to manage the scenes
const stage = new Scenes.Stage([manualDepositScene]);

// Export a function that attaches the session and stage middleware to the bot.
module.exports = function (bot) {
  bot.use(session());
  bot.use(stage.middleware());
};