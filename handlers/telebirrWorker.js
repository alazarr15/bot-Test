// telebirrWorker_complete.js
// Worker process for handling Telebirr automation using WebdriverIO and Appium

const wdio = require("webdriverio");

// ⚠️ SECURITY: Use environment variables for sensitive info
const TELETIRR_LOGIN_PIN = process.env.TELEBIRR_LOGIN_PIN;
const TELETIRR_PHONE = process.env.TELETIRR_PHONE;

if (!TELETIRR_LOGIN_PIN || !TELETIRR_PHONE) {
    throw new Error("Missing required environment variables: TELEBIRR_LOGIN_PIN or TELETIRR_PHONE.");
}

// WebdriverIO/Appium options
const opts = {
    protocol: 'http',
    hostname: '188.245.100.132', // Appium server host
    port: 4723,
    path: '/',
    capabilities: {
        alwaysMatch: {
            platformName: "Android",
            "appium:deviceName": "10.0.0.4:38185",
            "appium:automationName": "UiAutomator2",
            "appium:appPackage": "cn.tydic.ethiopay",
            "appium:appActivity": "com.huawei.module_basic_ui.splash.LauncherActivity",
            "appium:noReset": true,
            "appium:newCommandTimeout": 6000
        }
    }
};



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

// Helper to enter login PIN
async function enterPin(driver, pin) {
    for (let digit of pin) {
        const btn = await driver.$(`id=${KEYPAD[digit]}`);
        await btn.click();
    }
}

// Helper to enter transaction PIN
async function enterTransactionPin(driver, pin) {
    for (let digit of pin) {
        const btn = await driver.$(`android=new UiSelector().resourceId("cn.tydic.ethiopay:id/tv_key").text("${digit}")`);
        if (await btn.isDisplayed() && await btn.isEnabled()) {
            await btn.click();
        } else {
            throw new Error(`PIN key ${digit} not found or not clickable`);
        }
    }
}

async function processTelebirrWithdrawal({amount, account_number}) {
    let driver;
    const result = {
        status: "",
        message: "",
        data: null
    };
    try {
        driver = await wdio.remote(opts);
        console.log("✅ App launched successfully");

        // --- Step 1: Login ---
        console.log("🔹 Logging in...");
        const loginNextBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_next");
        await loginNextBtn.click();
        await enterPin(driver, TELETIRR_LOGIN_PIN);

        // Wait for the main page to load with a longer timeout
        console.log("⏱️ Waiting for main screen to load...");
        const mainPageBtn = await driver.$("id=cn.tydic.ethiopay:id/rl_function_container");
        await mainPageBtn.waitForDisplayed({ timeout: 15000 });
        console.log("✅ Main screen loaded.");

        // --- Step 2: Navigate to Send Money ---
        console.log("🔹 Navigating to 'Send Money'...");
        await mainPageBtn.click();

        // Wait for the individual transfer button to be displayed
        const individualBtn = await driver.$("//android.view.ViewGroup[@clickable='true']");
        await individualBtn.waitForDisplayed({ timeout: 5000 });
        await individualBtn.click();

        // --- Step 3: Enter recipient details ---
        console.log("🔹 Entering recipient details...");
        const phoneInput = await driver.$("id=cn.tydic.ethiopay:id/et_input");
        await phoneInput.waitForDisplayed({ timeout: 5000 });
        await phoneInput.setValue(account_number);

        const nextPhoneBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_next");
        await nextPhoneBtn.click();

        // --- Step 4: Enter amount ---
        console.log("🔹 Entering amount...");
        const amountInput = await driver.$("id=cn.tydic.ethiopay:id/et_amount");
        await amountInput.waitForDisplayed({ timeout: 5000 });
        await amountInput.setValue(String(amount));

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

        const sendBtn = await driver.$("id=cn.tydic.ethiopay:id/confirm");
        await sendBtn.click();

        // --- Step 5: Enter transaction PIN and confirm ---
        console.log("🔹 Entering transaction PIN...");
        const transactionPinKeypad = await driver.$('android=new UiSelector().resourceId("cn.tydic.ethiopay:id/tv_key").text("1")');
        await transactionPinKeypad.waitForDisplayed({ timeout: 5000 });
        await enterTransactionPin(driver, TELETIRR_LOGIN_PIN);

        const finishedBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_confirm");
        await finishedBtn.click();

        // If reached here, transaction is successful
        result.status = "success";
        result.message = "Transaction completed successfully";
        result.data = { phone: account_number, amount: amount };

    } catch (err) {
        console.error("❌ Error during automation:", err);
        result.status = "fail";
        result.message = err.message || "Unknown error";
        result.data = { error: err.toString() };
    } finally {
        if (driver) await driver.deleteSession();
        console.log("Session ended");
        console.log(JSON.stringify(result, null, 2));
        return result; // can be captured by other modules
    }
}
module.exports = { processTelebirrWithdrawal };
