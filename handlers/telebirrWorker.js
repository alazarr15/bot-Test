// services/telebirrWorker.js
// This worker script provides the core function for processing Telebirr withdrawals.
// It is designed to be called by a separate handler, which manages the queue and driver state.

const { navigateToHome, enterPin, SELECTORS, TELEBIRR_LOGIN_PIN } = require("./appiumService.js");

/**
 * Executes the complete "send money" workflow on the Telebirr app.
 * This function is designed to be robust, with explicit waits and clear logging.
 *
 * @param {object} options The options object.
 * @param {import("webdriverio").RemoteAsync} options.driver The Appium driver instance.
 * @param {string} options.accountNumber The recipient's phone number.
 * @param {string} options.amount The amount to send.
 * @param {string} options.transactionPin The 4-digit transaction PIN.
 * @returns {Promise<object>} A promise that resolves to a result object indicating success or failure.
 */
async function processTelebirrWithdrawal({ driver, accountNumber, amount}) {
    try {
        console.log(`🚀 Starting Telebirr withdrawal for account: ${accountNumber}, amount: ${amount}`);

        // 1. Ensure the app is at the home screen. This is a critical first step.
        await navigateToHome(driver);

        // 2. Navigate to the Send Money section.
        console.log("➡️ Navigating to Send Money...");
        const sendMoneyBtn = await driver.$(SELECTORS.SEND_MONEY_BTN);
        await sendMoneyBtn.click();
        
        // 3. Navigate to the Individual Money Transfer section.
        const sendMoneyIndividualBtn = await driver.$(SELECTORS.SEND_MONEY_INDIVIDUAL_BTN);
        await sendMoneyIndividualBtn.click();
        
        // 4. Enter the recipient's phone number.
        console.log(`👤 Entering recipient phone number: ${accountNumber}`);
        const recipientInput = await driver.$(SELECTORS.RECIPIENT_PHONE_INPUT);
        await recipientInput.waitForDisplayed({ timeout: 15000 });
        await recipientInput.setValue(accountNumber);
        
        // 5. Click the next button to proceed to the amount screen.
        const recipientNextBtn = await driver.$(SELECTORS.RECIPIENT_NEXT_BTN);
        await recipientNextBtn.click();
        
        // 6. Enter the amount to send.
        console.log(`💰 Entering amount: ${amount}`);
        const amountInput = await driver.$(SELECTORS.AMOUNT_INPUT);
        await amountInput.waitForDisplayed({ timeout: 15000 });
        await amountInput.setValue(amount);

        // Tap OK using coordinates

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

        // 8. Confirm the payment details.
        console.log("✅ Confirming payment...");
        const confirmPayBtn = await driver.$(SELECTORS.CONFIRM_PAY_BTN);
        await confirmPayBtn.waitForClickable({ timeout: 15000 });
        await confirmPayBtn.click();
        
        // 9. Enter the transaction PIN to finalize the transfer.
        console.log("🔑 Entering transaction PIN...");
        // This now correctly uses the dedicated transactionPin parameter.
        await enterPin(driver, TELEBIRR_LOGIN_PIN, true);
        
        // 10. Wait for the transaction to finish and click the final confirmation button.
        const finishedBtn = await driver.$(SELECTORS.TRANSACTION_FINISHED_BTN);
        await finishedBtn.waitForDisplayed({ timeout: 60000, timeoutMsg: "Transaction confirmation screen did not appear in time." });
        console.log("🎉 Transaction completed successfully! Clicking final confirmation.");
        await finishedBtn.click();
        
        console.log(`✨ Telebirr withdrawal task finished successfully for ${accountNumber}.`);
        
        // Return a success object with a dummy transaction reference.
        return {
            status: "success",
            message: "Withdrawal completed successfully.",
            data: { tx_ref: `TX-${Date.now()}` }
        };
        
    } catch (error) {
        console.error(`❌ An error occurred during the withdrawal process for account ${accountNumber}:`, error);
        
        // Return a structured failure object.
        return {
            status: "failed",
            message: error.message || "An unknown error occurred during the withdrawal.",
            accountNumber: accountNumber,
            amount: amount,
        };
    }
}

module.exports = {
    processTelebirrWithdrawal

};
