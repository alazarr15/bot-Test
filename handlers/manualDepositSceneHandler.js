// handlers/manualDepositSceneHandler.js

// Import necessary Telegraf modules for scene management
const { Telegraf, Scenes, session } = require("telegraf");
const User = require("../Model/user"); // Import your User model
const SmsMessage = require("../Model/SmsMessage"); // Import your SMS message model
const { userRateLimiter, globalRateLimiter } = require("../Limit/global");

// This is a placeholder for your deposit database functions.
const DepositRequest = {
  create: async (data) => {
    console.log("Saving new deposit request to database:", data);
    return {
      id: "deposit-" + new Date().getTime(), // Mock ID
      ...data,
      createdAt: new Date(),
    };
  },
  update: async (depositId, newData) => {
    console.log(`Updating deposit ${depositId} with data:`, newData);
    // ⚠️ IMPORTANT: You must implement this function to update the deposit status in your database.
    // Example for a MongoDB model:
    // await DepositModel.findByIdAndUpdate(depositId, newData);
  }
};

// =================================================================
// ➡️ Define the Manual Deposit Scene (Wizard Scene)
// A "scene" is a sequence of steps (like a wizard)
// The ctx.scene.state object is used to persist data between steps
// =================================================================

const manualDepositScene = new Scenes.WizardScene(
  "manualDeposit", // unique ID for the scene

  // Step 1: Ask for the amount
  async (ctx) => {
    // ⭐ Check for /cancel here
    if (ctx.message && (ctx.message.text === "/cancel" || ctx.message.text.toLowerCase() === "cancel")) {
      await ctx.reply("❌ Manual deposit cancelled.");
      return ctx.scene.leave();
    }

    try {
      // ✅ Rate limit check for scene entry
      await userRateLimiter.consume(ctx.from.id);
      await globalRateLimiter.consume("global");
      
      // ⭐ Added cancel instruction
      await ctx.reply("💰 ለማስገባት የሚፈልጉትን መጠን ያስገቡ: (ለመውጣት /cancel )");
      return ctx.wizard.next(); // Go to the next step
    } catch (err) {
      if (err && err.msBeforeNext) {
        await ctx.reply("⚠️ Too many requests. Please wait a moment before trying again.");
      } else {
        console.error("❌ Error entering manualDepositScene:", err.message);
        await ctx.reply("🚫 An error occurred. Please try again.");
      }
      return ctx.scene.leave(); // IMPORTANT: Exit the scene on error
    }
  },

  // Step 2: Receive the amount and ask for the payment method
  async (ctx) => {
    // ⭐ Check for /cancel here
    if (ctx.message && (ctx.message.text === "/cancel" || ctx.message.text.toLowerCase() === "cancel")) {
      await ctx.reply("❌ Manual deposit cancelled.");
      return ctx.scene.leave();
    }

    const amount = parseFloat(ctx.message.text);
    
    // Validate if the input is a valid positive number
    if (isNaN(amount) || amount <= 0) {
      // ⭐ Added cancel instruction
    await ctx.reply("🚫 የተሳሳተ መጠን። እባክዎ ትክክለኛ ቁጥር ያስገቡ (ለምሳሌ፦ 100)። (ለመውጣት /cancel ይጻፉ)");  
    return; // Stay on this step until valid input is received
    }

    ctx.wizard.state.depositAmount = amount;
    
    // Provide inline keyboard with payment options
    await ctx.reply(`💰 የሚፈልጉት ${amount} ብር ለማስገባት ነው። እባክዎ የክፍያ ዘዴዎን ይምረጡ: (ለመውጣት /cancel ይጻፉ)`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "CBE to CBE", callback_data: "payment_cbe" }],
          [{ text: "Telebirr To Telebirr", callback_data: "payment_telebirr" }]
        ],
      },
    });

    return ctx.wizard.next(); // Go to the next step
  },

  // Step 3: Handle the payment method selection and provide instructions
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
        // ⭐ CORRECTED TEXT: Note the backslashes \ before special characters
        instructions = `
        የኢትዮጵያ ንግድ ባንክ አካውንት
        \`1000454544246\`

        1\\. ከላይ ባለው የኢትዮጵያ ንግድ ባንክ አካውንት ${amount} ብር ያስገቡ

        2\\. የምትልኩት የገንዘብ መጠን እና እዚ ላይ እንዲሞላልዎ የምታስገቡት የብር መጠን ተመሳሳይ መሆኑን እርግጠኛ ይሁኑ

        3\\. ብሩን ስትልኩ የከፈላችሁበትን መረጃ የያዘ አጭር የጹሁፍ መልክት(sms) ከኢትዮጵያ ንግድ ባንክ ይደርሳችኋል

        4\\. የደረሳችሁን አጭር የጹሁፍ መለክት(sms) ሙሉዉን ኮፒ(copy) በማረግ ከታች ባለው የቴሌግራም የጹሁፍ ማስገቢያው ላይ ፔስት(paste) በማረግ ይላኩት 

        5\\. ብር ስትልኩ የምትጠቀሙት USSD\(\*889#\) ከሆነ አንዳንዴ አጭር የጹሁፍ መለክት(sms) ላይገባላቹ ስለሚችል ከUSSD\(\*889#\) ሂደት መጨረሻ ላይ Complete የሚለው ላይ ስደርሱ 3 ቁጥርን በመጫን የትራንዛክሽን ቁጥሩን ሲያሳያቹህ ትራንዛክሽን ቁጥሩን ጽፎ ማስቀመጥ ይኖርባችኋል 

        ማሳሰቢያ፡ 1\\. አጭር የጹሁፍ መለክት(sms) ካልደረሳቹ ያለትራንዛክሽን ቁጥር ሲስተሙ ዋሌት ስለማይሞላላቹ የከፈላችሁበትን ደረሰኝ ከባንክ በመቀበል በማንኛውም ሰአት ትራንዛክሽን ቁጥሩን ቦቱ ላይ ማስገባት ትችላላቹ 

        የሚያጋጥማቹ የክፍያ ችግር ካለ @luckybingos በዚ ኤጀንቱን ማዋራት ይችላሉ::

        የከፈለችሁበትን አጭр የጹሁፍ መለክት(sms) ወይም FT ብሎ የሚጀምረዉን የትራንዛክሽን ቁጥር እዚ ላይ ያስገቡት 👇👇👇`;

    } else if (method === "payment_telebirr") {
        depositType = "ቴሌብር";
        // ⭐ CORRECTED TEXT: Note the bold formatting is kept, but periods are escaped
        instructions = `
        📱 *የቴሌብር ዝርዝሮች*
        የቴሌብር አካውንት
        \`0930534417\`

        1\\. ከላይ ባለው የቴሌብር አካውንት ${amount} ብር ያስገቡ

        2\\. የምትልኩት የገንዘብ መጠን እና እዚ ላይ እንዲሞላልዎ የምታስገቡት የብር መጠን ተመሳሳይ መሆኑን እርግጠኛ ይሁኑ

        3\\. ብሩን ስትልኩ የከፈላችሁበትን መረጃ የያዝ አጭር የጹሁፍ መለክት(sms) ከቴሌብር ይደርሳችኋል

        4\\. የደረሳችሁን አጭር የጹሁፍ መለክት(sms) ሙሉዉን ኮፒ(copy) በማረግ ከታሽ ባለው የቴሌግራም የጹሁፍ ማስገቢአው ላይ ፔስት(paste) በማረግ ይላኩት 
            
        የሚያጋጥማቹ የክፍያ ችግር ካለ @luckybingos በዚ ኤጀንቱን ማዋራት ይችላሉ 

        የከፈለችሁበትን አጭር የጹሁፍ መለክት(sms) እዚ ላይ ያስገቡት 👇👇👇`;
    }

    await ctx.answerCbQuery();
    // ⭐ CORRECTED PARSE MODE
    await ctx.reply(instructions, { parse_mode: "MarkdownV2" });

    const newDeposit = await DepositRequest.create({
      telegramId: ctx.from.id,
      amount: amount,
      method: depositType,
      status: "pending",
    });
    ctx.wizard.state.depositRequestId = newDeposit.id;

    console.log("Created deposit request ID:", newDeposit.id);

    return ctx.wizard.next(); 
},

 // ➡️ Step 4: Receive and verify the user's confirmation message and transaction ID

async (ctx) => {
  // ⭐ Check for /cancel here
  if (ctx.message && (ctx.message.text === "/cancel" || ctx.message.text.toLowerCase() === "cancel")) {
      await ctx.reply("❌ Manual deposit cancelled.");
      return ctx.scene.leave();
  }

  const userMessage = ctx.message?.text || ctx.message?.caption;
  const telegramId = ctx.from.id;
  const claimedAmount = ctx.wizard.state.depositAmount;

  // Check if the message is valid
  if (!userMessage) {
      await ctx.reply("❌ I'm sorry, I can only process text or image captions. Please try forwarding the message again. (Type /cancel to exit)");
      return; // Stay in this step
  }

  try {
      // ⭐ UPDATED: Use a more specific regex to match both CBE and Telebirr IDs
      // This is more secure and reliable than the previous version.
      const cbeRegex = /(FT[A-Z0-9]{10})/i;
      const telebirrRegex = /(?:transaction number is|የሂሳብ እንቅስቃሴ ቁጥርዎ|Lakkoofsi sochii maallaqaa keessan|ቁፅሪ ሒሳብ ዝተንቀሳቀሰ|lambarka hawlgalkaaguna waa)\s*([A-Z0-9]{10})\'?/i;

      let transactionId = null;

      const cbeMatch = userMessage.match(cbeRegex);
      const telebirrMatch = userMessage.match(telebirrRegex);
      
      // Check which pattern matched and extract the ID
      if (cbeMatch && cbeMatch[1]) {
          transactionId = cbeMatch[1];
      } else if (telebirrMatch && telebirrMatch[1]) {
          transactionId = telebirrMatch[1];
      }

      // Check for a valid ID
      if (!transactionId) {
          await ctx.reply("🚫 የገለበጡት መልእክት ትክክለኛ የCBE ወይም የቴሌብር የግብይት መለያ አይዟልም። እባክዎ የመጀመሪያውን ማረጋገጫ መልእክት መላልዎን ያረጋግጡ። (ለመውጣት /cancel ይጻፉ)");
          return ctx.scene.leave();
      }
      console.log(`Attempting to match transaction ID: ${transactionId}`);

      // Find a matching pending SMS in the database
      const matchingSms = await SmsMessage.findOne({
          status: "pending",
          $and: [
              { message: { $regex: new RegExp(transactionId, "i") } },
              { message: { $regex: new RegExp(claimedAmount.toFixed(2).replace('.', '\\.'), "i") } }
          ]
      });
    
      if (matchingSms) {
          await DepositRequest.update(ctx.wizard.state.depositRequestId, { status: "approved" });
          matchingSms.status = "processed";
          await matchingSms.save();

          const user = await User.findOne({ telegramId });
          if (user) {
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
      console.error("❌ Error processing manual deposit message:", error);
      await ctx.reply("🚫 An error occurred while processing your request. Please try again or contact support. (Type /cancel to exit)");
  }

  // Regardless of outcome, end the scene
  return ctx.scene.leave();
}
);

// Create a stage to manage the scenes
const stage = new Scenes.Stage([manualDepositScene]);

// Export a function that attaches the session and stage middleware to the bot.
module.exports = function (bot) {
  // Use session and stage middleware for all incoming updat
  bot.use(session());
  bot.use(stage.middleware());
};