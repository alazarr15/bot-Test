// telebirrWorker.js
// Handles a full Telebirr withdrawal task with automatic recovery and retries.

const {
  safeAction,
  navigateToHome,
  enterPin,
  SELECTORS,
  TELEBIRR_LOGIN_PIN,
  recoverAppiumSession,
  getDriver
} = require("./appiumService.js");

/**
 * Executes a complete "send money" workflow on the Telebirr app.
 * Automatically recovers from app / driver crashes.
 *
 * @param {object} options
 * @param {string} options.account_number - The recipient's phone number.
 * @param {string} options.amount - The amount to send.
 * @returns {Promise<object>} Result object.
 */
async function processTelebirrWithdrawal({ account_number, amount }) {
  return safeAction(async (driver) => {
    try {
      console.log("🚀 Starting the Telebirr withdrawal task...");

      // 1. Ensure the app is at the home screen.
      await navigateToHome();

      // 2. Go to Send Money
      console.log("➡️ Navigating to Send Money...");
      const sendMoneyBtn = await driver.$(SELECTORS.SEND_MONEY_BTN);
      await sendMoneyBtn.click();

      // 3. Individual transfer
      const sendMoneyIndividualBtn = await driver.$(SELECTORS.SEND_MONEY_INDIVIDUAL_BTN);
      await sendMoneyIndividualBtn.click();

      // 4. Enter recipient number
      console.log(`👤 Entering recipient phone number: ${account_number}`);
      const recipientInput = await driver.$(SELECTORS.RECIPIENT_PHONE_INPUT);
      await recipientInput.setValue(account_number);

      // 5. Next
      const recipientNextBtn = await driver.$(SELECTORS.RECIPIENT_NEXT_BTN);
      await recipientNextBtn.click();

      // 6. Enter amount
      console.log(`💰 Entering amount: ${amount}`);
      const amountInput = await driver.$(SELECTORS.AMOUNT_INPUT);
      await amountInput.setValue(amount);

      // Tap OK using coordinates
      console.log("🔹 Tapping OK button...");
      await driver.performActions([
        {
          type: "pointer",
          id: "finger1",
          parameters: { pointerType: "touch" },
          actions: [
            { type: "pointerMove", duration: 0, x: 942, y: 2050 },
            { type: "pointerDown", button: 0 },
            { type: "pointerUp", button: 0 },
          ],
        },
      ]);
      await driver.releaseActions();

      // 7. Confirm
      console.log("✅ Confirming payment...");
      const confirmPayBtn = await driver.$(SELECTORS.CONFIRM_PAY_BTN);
      await confirmPayBtn.click();

      // 8. PIN
      console.log("🔑 Entering transaction PIN...");
      await enterPin(TELEBIRR_LOGIN_PIN, true);

      // 9. Wait for completion
      const finishedBtn = await driver.$(SELECTORS.TRANSACTION_FINISHED_BTN);
      await finishedBtn.waitForDisplayed({ timeout: 60000 });
      console.log("🎉 Transaction completed successfully! Clicking final confirmation.");
      await finishedBtn.click();

      console.log("✨ Telebirr withdrawal task finished.");

      return {
        status: "success",
        message: "Withdrawal completed successfully.",
        data: { tx_ref: `TX-${Date.now()}` },
      };
    } catch (error) {
      console.error("❌ Error during withdrawal:", error.message);

      // Handle known crashes and auto-recover
      if (
        error.message.includes("instrumentation process is not running") ||
        error.message.includes("UiAutomator") ||
        error.message.includes("session not created") ||
        error.message.includes("socket hang up")
      ) {
        console.warn("⚠️ Detected driver crash. Recovering Appium session...");
        await recoverAppiumSession();
        const newDriver = await getDriver();

        // Retry once automatically
        console.log("🔁 Retrying withdrawal after recovery...");
        return await processTelebirrWithdrawal({ account_number, amount });
      }

      // Non-recoverable error
      return {
        status: "failed",
        message: error.message,
      };
    }
  });
}

module.exports = { processTelebirrWithdrawal };
