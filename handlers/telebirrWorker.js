// telebirrWorker_updated.js
// This file is a separate worker process dedicated to handling the WebdriverIO automation.

const wdio = require("webdriverio");

// ⚠️ SECURITY IMPROVEMENT:
// Removed hardcoded default values. We now throw an error if the environment
// variables are not set. Hardcoding sensitive data is a major security risk.
const TELETIRR_LOGIN_PIN = process.env.TELEBIRR_LOGIN_PIN;
const TELETIRR_PHONE = process.env.TELEBIRR_PHONE;

if (!TELETIRR_LOGIN_PIN || !TELETIRR_PHONE) {
    throw new Error("Missing required environment variables: TELEBIRR_LOGIN_PIN or TELEBIRR_PHONE.");
}

const opts = {
    protocol: 'http',
    hostname: '188.245.100.132',  // ✅ Use localhost since container is in host network
    port: 4723,
    path: '/wd/hub',
    capabilities: {
        alwaysMatch: {
            platformName: "Android",
            "appium:deviceName": "10.0.0.4:38999", // Keep this same if adb connect is correct
            "appium:automationName": "UiAutomator2",
            "appium:appPackage": "cn.tydic.ethiopay",
            "appium:appActivity": "com.huawei.module_basic_ui.splash.LauncherActivity",
            "appium:noReset": true,
            "appium:newCommandTimeout": 6000
        }
    }
};


// Helper for login PIN keypad. This looks correct.
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

// ⚠️ REFACTORING IMPROVEMENT:
// Combined enterPin and enterTransactionPin into a single, more robust function.
// This reduces code duplication and makes it easier to maintain.
async function enterPin(driver, pin, isTransactionPin = false) {
    const pinType = isTransactionPin ? "Transaction" : "Login";
    console.log(`Entering ${pinType} PIN...`);
    for (let digit of pin) {
        console.log(`Clicking button for digit: ${digit}`);
        let btn;
        if (isTransactionPin) {
            // Use a more specific selector if possible, otherwise rely on the text
            btn = await driver.$(`android=new UiSelector().resourceId("cn.tydic.ethiopay:id/tv_key").text("${digit}")`);
        } else {
            btn = await driver.$(`id=${KEYPAD[digit]}`);
        }
        await btn.waitForExist({ timeoutMsg: `PIN button for digit ${digit} not found` });
        await btn.click();
    }
    console.log(`${pinType} PIN entered successfully.`);
}

// The main function that performs the Telebirr withdrawal automation
async function processTelebirrWithdrawal({ amount, account_number }) {
    let driver;
    const result = {
        status: "",
        message: "",
        data: null
    };

    try {
        console.log("Starting WebdriverIO session...");
        // ⚠️ Device name updated to the one from your successful ADB connection
        opts.capabilities.alwaysMatch["appium:deviceName"] = "10.0.0.4:38999";
        driver = await wdio.remote(opts);
        console.log("✅ App launched successfully");

        // 1️⃣ Click Next on login page
        console.log("Clicking 'Next' button on login page.");
        const loginNextBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_next");
        await loginNextBtn.waitForExist();
        await loginNextBtn.click();
        console.log("'Next' button clicked.");

        // 2️⃣ Enter login PIN
        await enterPin(driver, TELETIRR_LOGIN_PIN, false);

        // 3️⃣ Click Send Money
        console.log("Clicking 'Send Money' button.");
        const sendMoneyBtn = await driver.$("id=cn.tydic.ethiopay:id/rl_function_container");
        await sendMoneyBtn.waitForExist();
        await sendMoneyBtn.click();
        console.log("'Send Money' button clicked.");

        // 4️⃣ Individual recipient
        console.log("Clicking 'Individual recipient'.");
        // ⚠️ IMPROVEMENT: The previous selector was too generic.
        // A more specific selector should be used if the UI changes.
        // For now, let's keep the generic one but add a comment.
        const individualBtn = await driver.$("//android.widget.TextView[@resource-id='cn.tydic.ethiopay:id/title' and @text='Individual recipient']");
        await individualBtn.waitForExist();
        await individualBtn.click();
        console.log("'Individual recipient' clicked.");

        // 5️⃣ Enter phone number
        console.log(`Entering phone number: ${account_number}`);
        const phoneInput = await driver.$("id=cn.tydic.ethiopay:id/et_input");
        await phoneInput.waitForExist();
        await phoneInput.setValue(account_number);
        console.log("Phone number entered.");

        // 6️⃣ Next after phone
        console.log("Clicking 'Next' after phone number.");
        const nextPhoneBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_next");
        await nextPhoneBtn.waitForExist();
        await nextPhoneBtn.click();
        console.log("'Next' button clicked.");

        // 7️⃣ Enter amount
        console.log(`Entering amount: ${amount}`);
        const amountInputWrapper = await driver.$("id=cn.tydic.ethiopay:id/et_amount_click_view");
        await amountInputWrapper.waitForExist();
        await amountInputWrapper.click();

        const amountInput = await driver.$("id=cn.tydic.ethiopay:id/et_amount");
        await amountInput.waitForExist();
        await amountInput.setValue(String(amount));

        console.log("Amount entered. Tapping OK button.");
        // ⚠️ IMPROVEMENT: Replaced coordinate-based click with element-based click.
        // This is much more reliable and works on different screen sizes.
        const okButton = await driver.$(`android=new UiSelector().resourceId("cn.tydic.ethiopay:id/btn_ok")`);
        await okButton.waitForExist();
        await okButton.click();
        console.log("OK button tapped.");

        // 8️⃣ Click Send
        console.log("Clicking 'Send' button.");
        const sendBtn = await driver.$("id=cn.tydic.ethiopay:id/confirm");
        await sendBtn.waitForExist();
        await sendBtn.click();
        console.log("'Send' button clicked.");

        // 🔟 Confirm transaction PIN
        // ⚠️ IMPROVEMENT: Using the more generic enterPin function and passing true for the flag.
        // Note: The original code used the LOGIN PIN for the transaction PIN.
        // If a separate transaction PIN is required, a new environment variable should be used.
        await enterPin(driver, TELETIRR_LOGIN_PIN, true);

        // 1️⃣1️⃣ Click Finish
        console.log("Clicking 'Finish' button.");
        const finishedBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_confirm");
        await finishedBtn.waitForExist();
        await finishedBtn.click();
        console.log("'Finish' button clicked.");

        // If reached here, transaction is successful
        result.status = "success";
        result.message = "Transaction completed successfully";
        result.data = { phone: account_number, amount: amount, tx_ref: `telebirr_tx_${Date.now()}` };
        console.log("🚀🚀 successful", result.message, result.data);

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
