// workers/telebirrWorker.js
const { getDriver, navigateToHome, enterPin, SELECTORS, TELEBIRR_LOGIN_PIN, resetDriver } = require("../services/appiumService.js");

/**
 * Executes the complete "send money" workflow on the Telebirr app.
 * Includes auto-retry on driver crashes or unknown screens.
 * @param {object} options
 * @param {string} options.account_number Recipient's phone number
 * @param {string} options.amount Amount to send
 * @returns {Promise<object>} Result object
 */
async function processTelebirrWithdrawal({ account_number, amount }) {
    let driver;
    try {
        driver = await getDriver();
        console.log("🚀 Starting Telebirr withdrawal task...");

        // Ensure app is on home screen
        await navigateToHome();

        // 1️⃣ Navigate to Send Money
        console.log("➡️ Navigating to Send Money...");
        const sendMoneyBtn = await driver.$(SELECTORS.SEND_MONEY_BTN);
        await sendMoneyBtn.click();

        // 2️⃣ Navigate to Individual Transfer
        const sendMoneyIndividualBtn = await driver.$(SELECTORS.SEND_MONEY_INDIVIDUAL_BTN);
        await sendMoneyIndividualBtn.click();

        // 3️⃣ Enter recipient phone number
        console.log(`👤 Entering recipient phone: ${account_number}`);
        const recipientInput = await driver.$(SELECTORS.RECIPIENT_PHONE_INPUT);
        await recipientInput.setValue(account_number);

        // 4️⃣ Click Next
        const recipientNextBtn = await driver.$(SELECTORS.RECIPIENT_NEXT_BTN);
        await recipientNextBtn.click();

        // 5️⃣ Enter amount
        console.log(`💰 Entering amount: ${amount}`);
        const amountInput = await driver.$(SELECTORS.AMOUNT_INPUT);
        await amountInput.setValue(amount);

        // 6️⃣ Tap OK using coordinates (fallback for apps with hidden buttons)
        console.log("🔹 Tapping OK button...");
        await driver.performActions([{
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
                { type: 'pointerMove', duration: 0, x: 942, y: 2050 },
                { type: 'pointerDown', button: 0 },
                { type: 'pointerUp', button: 0 }
            ]
        }]);
        await driver.releaseActions();

        // 7️⃣ Confirm payment
        console.log("✅ Confirming payment...");
        const confirmPayBtn = await driver.$(SELECTORS.CONFIRM_PAY_BTN);
        await confirmPayBtn.click();

        // 8️⃣ Enter transaction PIN
        console.log("🔑 Entering transaction PIN...");
        await enterPin(driver, TELEBIRR_LOGIN_PIN, true);

        // 9️⃣ Wait for final confirmation
        const finishedBtn = await driver.$(SELECTORS.TRANSACTION_FINISHED_BTN);
        await finishedBtn.waitForDisplayed({ timeout: 60000 });
        console.log("🎉 Transaction completed. Clicking final confirmation.");
        await finishedBtn.click();

        return { status: "success", message: "Withdrawal completed successfully.", data: { tx_ref: `TX-${Date.now()}` } };

    } catch (error) {
        console.error("❌ Telebirr withdrawal failed:", error);

        // If the driver crashed or instrumentation lost, reset driver for next retry
        if (error.message.includes("WebDriverError") || error.message.includes("instrumentation process is not running")) {
            resetDriver();
        }

        return { status: "failed", message: error.message };
    }
}

module.exports = { processTelebirrWithdrawal };
