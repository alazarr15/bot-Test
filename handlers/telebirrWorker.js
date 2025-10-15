// This worker script provides the core function for processing Telebirr withdrawals.
// It is designed to be called by a separate handler, which manages the queue and driver state.

// Import necessary functions, including the critical safeAction
const { navigateToHome, enterPin, SELECTORS, TELEBIRR_LOGIN_PIN, safeAction } = require("./appiumService.js");

/**
 * Executes the complete "send money" workflow on the Telebirr app.
 * The core transaction logic is encapsulated in safeAction for stability and retry capability.
 * * @param {object} options The options object.
 * @param {string} options.account_number The recipient's phone number.
 * @param {string} options.amount The amount to send.
 * @returns {Promise<object>} A promise that resolves to a result object.
 */
async function processTelebirrWithdrawal({ account_number, amount}) {
    try {
        console.log("🚀 Starting the Telebirr withdrawal task...");

        // 1. Ensure the app is at the home screen. 
        // navigateToHome() uses safeAction internally for login/navigation resilience.
        await navigateToHome();

        // 2. Encapsulate the entire sequential transaction process in a single safeAction block.
        // If any step inside this block fails due to a session issue, the whole block will retry.
        await safeAction(async (driver) => {

            // 2. Navigate to the Send Money section.
            console.log("➡️ Navigating to Send Money...");
            const sendMoneyBtn = await driver.$(SELECTORS.SEND_MONEY_BTN);
            await sendMoneyBtn.click();
            
            // 3. Navigate to the Individual Money Transfer section.
            const sendMoneyIndividualBtn = await driver.$(SELECTORS.SEND_MONEY_INDIVIDUAL_BTN);
            await sendMoneyIndividualBtn.click();
            
            // 4. Enter the recipient's phone number.
            console.log(`👤 Entering recipient phone number: ${account_number}`);
            const recipientInput = await driver.$(SELECTORS.RECIPIENT_PHONE_INPUT);
            await recipientInput.setValue(account_number);
            
            // 5. Click the next button.
            const recipientNextBtn = await driver.$(SELECTORS.RECIPIENT_NEXT_BTN);
            await recipientNextBtn.click();
            
            // 6. Enter the amount to send.
            console.log(`💰 Entering amount: ${amount}`);
            const amountInput = await driver.$(SELECTORS.AMOUNT_INPUT);
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


            // 7. Confirm the payment.
            console.log("✅ Confirming payment...");
            const confirmPayBtn = await driver.$(SELECTORS.CONFIRM_PAY_BTN);
            await confirmPayBtn.click();

            console.log("🔑 Entering transaction PIN...");
            await enterPin(TELEBIRR_LOGIN_PIN, true);
            
            // 9. Wait for the transaction to finish and the final confirmation button to appear.
            const finishedBtn = await driver.$(SELECTORS.TRANSACTION_FINISHED_BTN);
            await finishedBtn.waitForDisplayed({ timeout: 60000 });
            console.log("🎉 Transaction completed successfully! Clicking final confirmation.");
            await finishedBtn.click();
        });
        
        console.log("✨ Telebirr withdrawal task finished.");
        
        // Return a success object with a dummy transaction reference
        return {
            status: "success",
            message: "Withdrawal completed successfully.",
            data: { tx_ref: `TX-${Date.now()}` }
        };

    } catch (error) {
        console.error("❌ An error occurred during the withdrawal process:", error);
        // Return a failure object
        return {
            status: "failed",
            message: error.message
        };
    }
}

module.exports = {
    processTelebirrWithdrawal
};