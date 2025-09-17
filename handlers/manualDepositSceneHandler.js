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
    // Note: /cancel won't directly apply here if it's expecting a callback,
    // but the text handler's universal cancel should catch it.
    if (!ctx.callbackQuery || !ctx.callbackQuery.data.startsWith('payment_')) {
      // ⭐ Added cancel instruction
      await ctx.reply("Please use the buttons provided to select a payment method. (Type /cancel to exit)");
      return; // Wait for a button click
    }

    const method = ctx.callbackQuery.data;
    const amount = ctx.wizard.state.depositAmount;
    
    let instructions = "";
    let depositType = "";

   // Set instructions based on the user's choice
    if (method === "payment_cbe") {
      depositType = "CBE";
      instructions = `
    🏦 **የንግድ ባንክ ኢትዮጵያ (CBE) የባንክ ሂሳብ ዝርዝር**
    የሂሳብ ስም: BINGO GAMES 
    የሂሳብ ቁጥር: 1000454544246
    መጠን: ${amount} ብር

    እባክዎ ከላይ ያለውን ሂሳብ ቁጥር መጠን ያስተላልፉ እና ከዚያ **የተጠቃሚውን ማረጋገጫ መልእክት ወይም የግብይት ስክሪንሾት** ወደዚህ ቻት ይላኩ። (ለመውጣት /cancel ይጻፉ)`;
    } else if (method === "payment_telebirr") {
      depositType = "ቴሌብር";
      instructions = `
    📱 **የቴሌብር ዝርዝሮች**
    ስልክ ቁጥር: 0930534417
    መጠን: ${amount} ብር

    እባክዎ ከላይ ያለውን ቁጥር መጠን ይላኩ እና ከዚያ **የተጠቃሚውን ማረጋገጫ መልእክት ወይም የግብይት ስክሪንሾት** ወደዚህ ቻት ይላኩ። (ለመውጣት /cancel ይጻፉ)`;
    }

    // Acknowledge the button click and show the instructions
    await ctx.answerCbQuery();
    await ctx.reply(instructions, { parse_mode: "Markdown" });

    // Save the initial deposit request to the database
    const newDeposit = await DepositRequest.create({
      telegramId: ctx.from.id,
      amount: amount,
      method: depositType,
      status: "pending",
    });
    ctx.wizard.state.depositRequestId = newDeposit.id;

    console.log("Created deposit request ID:", newDeposit.id);

    // Go to the next step, which will wait for the user's message
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
          // ⭐ MODIFIED: Use a single comprehensive regex to capture both CBE and Telebirr IDs
          // This handles the full message as well as the transaction ID alone.
          const transactionIdMatch = userMessage.match(/(FT[A-Z0-9]{10})|([A-Z0-9]{10})/i);
          let transactionId = transactionIdMatch ? transactionIdMatch[0] : null;
          
          // Check for a valid ID and a length of 10 characters
          if (!transactionId || transactionId.length !== 10) {
              await ctx.reply("🚫 የገለበጡት መልእክት ትክክለኛ የCBE ወይም የቴሌብር የግብይት መለያ አይዟልም። እባክዎ የመጀመሪያውን ማረጋገጫ መልእክት መላልዎን ያረጋግጡ። (ለመውጣት /cancel ይጻፉ)");
              return ctx.scene.leave();
          }
          console.log(`Attempting to match transaction ID: ${transactionId}`);

          // ⭐ CORRECTED: FIND A MATCHING PENDING SMS IN THE DATABASE
          // This query correctly uses the extracted 10-character transaction ID AND the amount.
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