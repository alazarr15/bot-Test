// telebirrWorker.js
// This file is a separate worker process dedicated to handling the WebdriverIO automation.

const wdio = require("webdriverio");

// ⚠️ IMPORTANT: These values should be loaded from environment variables (e.g., .env file)
// and NOT hardcoded in the source code. This is a major security risk.
const TELETIRR_LOGIN_PIN = process.env.TELEBIRR_LOGIN_PIN || "103535";
const TELETIRR_PHONE = process.env.TELEBIRR_PHONE || "0989905112";

const opts = {
    path: '/',
    port: 4723,
    capabilities: {
        alwaysMatch: {
            platformName: "Android",
            "appium:deviceName": "192.168.1.4:5555",
            "appium:automationName": "UiAutomator2",
            "appium:appPackage": "cn.tydic.ethiopay",
            "appium:appActivity": "com.huawei.module_basic_ui.splash.LauncherActivity",
            "appium:noReset": true,
            "appium:newCommandTimeout": 6000
        }
    }
};

// Helper for login PIN keypad
const KEYPAD = {
    "0": "cn.tydic.ethiopay:id/tv_input_0",
    "1": "cn.tydic.ethiopay:id/tv_input_1",
    "2": "cn.tydic.ethiopay:id/tv_input_2",
    "3": "cn.tydic.ethiopay:id/tv_input_3",
    "4": "cn.tydic.ethiopay:id/tv_input_4",
    "5": "cn.tydic.ethiopay:id/tv_input_5",
    "6": "cn.tydic.ethiopay:id/tv_input_6",
    "7": "cn.tydic.ethiopay:id/tv_input_7",
    "8": "cn.tydic.ethiopay:id/tv_input_8",
    "9": "cn.tydic.ethiopay:id/tv_input_9"
};

// Helper function to enter the PIN
async function enterPin(driver, pin) {
    console.log("Entering PIN...");
    for (let digit of pin) {
        console.log(`Clicking button for digit: ${digit}`);
        const btn = await driver.$(`id=${KEYPAD[digit]}`);
        await btn.click();
    }
    console.log("PIN entered successfully.");
}

// Helper function to enter the transaction PIN
async function enterTransactionPin(driver, pin) {
    console.log("Entering transaction PIN...");
    for (let digit of pin) {
        console.log(`Clicking transaction key for digit: ${digit}`);
        const btn = await driver.$(`android=new UiSelector().resourceId("cn.tydic.ethiopay:id/tv_key").text("${digit}")`);
        if (await btn.isDisplayed() && await btn.isEnabled()) {
            await btn.click();
        } else {
            throw new Error(`PIN key ${digit} not found or not clickable`);
        }
    }
    console.log("Transaction PIN entered successfully.");
}

// The main function that performs the Telebirr withdrawal automation
// It is now an exported function that accepts parameters
async function processTelebirrWithdrawal({ amount, account_number }) {
    let driver;
    const result = {
        status: "",
        message: "",
        data: null
    };

    try {
        console.log("Starting WebdriverIO session...");
        driver = await wdio.remote(opts);
        console.log("✅ App launched successfully");

        // 1️⃣ Click Next on login page
        console.log("Clicking 'Next' button on login page.");
        const loginNextBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_next");
        await loginNextBtn.click();
        console.log("'Next' button clicked.");

        // 2️⃣ Enter login PIN
        await enterPin(driver, TELETIRR_LOGIN_PIN);

        // 3️⃣ Click Send Money
        console.log("Clicking 'Send Money' button.");
        const sendMoneyBtn = await driver.$("id=cn.tydic.ethiopay:id/rl_function_container");
        await sendMoneyBtn.click();
        console.log("'Send Money' button clicked.");

        // 4️⃣ Individual recipient
        console.log("Clicking 'Individual recipient'.");
        const individualBtn = await driver.$("//android.view.ViewGroup[@clickable='true']");
        await individualBtn.click();
        console.log("'Individual recipient' clicked.");

        // 5️⃣ Enter phone number
        console.log(`Entering phone number: ${account_number}`);
        const phoneInput = await driver.$("id=cn.tydic.ethiopay:id/et_input");
        // Use the phone number from the withdrawal request
        await phoneInput.setValue(account_number);
        console.log("Phone number entered.");

        // 6️⃣ Next after phone
        console.log("Clicking 'Next' after phone number.");
        const nextPhoneBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_next");
        await nextPhoneBtn.click();
        console.log("'Next' button clicked.");

        // 7️⃣ Enter amount
        console.log(`Entering amount: ${amount}`);
        const amountInputWrapper = await driver.$("id=cn.tydic.ethiopay:id/et_amount_click_view");
        await amountInputWrapper.click();
        
        const amountInput = await driver.$("id=cn.tydic.ethiopay:id/et_amount");
        // Use the amount from the withdrawal request
        await amountInput.setValue(String(amount)); 
        
        console.log("Amount entered. Tapping OK button.");
        // Tap OK button using coordinates
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
        console.log("OK button tapped.");

        // 8️⃣ Click Send
        console.log("Clicking 'Send' button.");
        const sendBtn = await driver.$("id=cn.tydic.ethiopay:id/confirm");
        await sendBtn.click();
        console.log("'Send' button clicked.");

        // 🔟 Confirm transaction PIN
        await enterTransactionPin(driver, TELETIRR_LOGIN_PIN);

        // 1️⃣1️⃣ Click Finish
        console.log("Clicking 'Finish' button.");
        const finishedBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_confirm");
        await finishedBtn.click();
        console.log("'Finish' button clicked.");

        // If reached here, transaction is successful
        result.status = "success";
        result.message = "Transaction completed successfully";
        result.data = { phone: account_number, amount: amount, tx_ref: `telebirr_tx_${Date.now()}` };
        console.log("🚀🚀 successful", result.message, result.data)

    } catch (err) {
        console.error("❌ Error during automation:", err);
        result.status = "fail";
        result.message = err.message || "Unknown error";
        result.data = { error: err.toString() };
    } finally {
        if (driver) await driver.deleteSession();
        console.log("Session ended");
        console.log(JSON.stringify(result, null, 2));
    }
    return result; // Return the result object
}

// Export the function so it can be called from the main handler
module.exports = {
    processTelebirrWithdrawal
};
