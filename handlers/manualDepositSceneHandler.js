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
      await ctx.reply("💰 Please enter the amount you want to deposit: (Type /cancel to exit)");
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
      await ctx.reply("🚫 Invalid amount. Please enter a valid number (e.g., 100). (Type /cancel to exit)");
      return; // Stay on this step until valid input is received
    }

    ctx.wizard.state.depositAmount = amount;
    
    // Provide inline keyboard with payment options
    await ctx.reply(`You want to deposit ${amount} ETB. Please select your payment method: (Type /cancel to exit)`, {
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
🏦 **CBE Bank Account Details**
Account Name: BINGO GAMES 
Account Number: 1000454544246
Amount: ${amount} ETB

Please transfer the amount to the above account and then **forward the confirmation message or a screenshot of the transaction** to this chat. (Type /cancel to exit)`;
    } else if (method === "payment_telebirr") {
      depositType = "Telebirr";
      instructions = `
📱 **Telebirr Details**
Phone Number: 0930534417
Amount: ${amount} ETB

Please send the amount to the above number and then **forward the confirmation message or a screenshot of the transaction** to this chat. (Type /cancel to exit)`;
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
        // ⭐ Added cancel instruction
        await ctx.reply("❌ I'm sorry, I can only process text or image captions. Please try forwarding the message again. (Type /cancel to exit)");
        return; // Stay in this step
    }

    try {
      // 👉 UPDATED: Regex now includes Telebirr's 10-character alphanumeric format.
      // 1. (FT[A-Z0-9]{10}) -> CBE FT format
      // 2. (\b\d{12}\b) -> CBE 12-digit format
      // 3. (\b[A-Z0-9]{10}\b) -> Telebirr 10-character format (e.g., CI90Q416Y4)
      const transactionIdRegex = /(FT[A-Z0-9]{10})|(\b\d{12}\b)|(\b[A-Z0-9]{10}\b)/i;
      const transactionIdMatch = userMessage.match(transactionIdRegex);
      
      if (!transactionIdMatch) {
        await ctx.reply("🚫 The forwarded message does not contain a valid CBE or Telebirr transaction ID. Please make sure you forwarded the original confirmation message. (Type /cancel to exit)");
        return ctx.scene.leave();
      }
      
      // 👉 UPDATED: Check all three possible capture groups for the transaction ID.
      const transactionId = transactionIdMatch[1] || transactionIdMatch[2] || transactionIdMatch[3];
      console.log(`Attempting to match transaction ID: ${transactionId}`);

      // 2. Create a regular expression for the amount.
      // This regex checks for amounts like "ETB 100.00" or just "100"
      const amountRegex = new RegExp(`ETB\\s*${claimedAmount.toFixed(2).replace('.', '\\.')}|${claimedAmount.toFixed(0)}`, 'i');
      
      // 3. Find a matching pending SMS in the database
      const matchingSms = await SmsMessage.findOne({
        message: { $regex: amountRegex },
        status: "pending",
        message: { $regex: new RegExp(transactionId, "i") }
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
            { new: true } // Return the updated document
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
  // Use session and stage middleware for all incoming updates
  bot.use(session());
  bot.use(stage.middleware());
};