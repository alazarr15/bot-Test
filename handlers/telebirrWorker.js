// telebirrWorker_final.js
// VERSION 5.0 - Final version with enhanced timeouts for stability on slow connections.

const wdio = require("webdriverio");

// ⚠️ SECURITY: Use environment variables for sensitive info
const TELEBIRR_LOGIN_PIN = process.env.TELEBIRR_LOGIN_PIN;
const TELEBIRR_PHONE = process.env.TELEBIRR_PHONE;

if (!TELEBIRR_LOGIN_PIN || !TELEBIRR_PHONE) {
    throw new Error("Missing required environment variables: TELEBIRR_LOGIN_PIN or TELEBIRR_PHONE.");
}

// WebdriverIO/Appium options with highly generous timeouts for maximum stability
const opts = {
    protocol: 'http',
    hostname: '188.245.100.132', // Appium server host
    port: 4723,
    path: '/',
    // ✅ STABILITY: How long to wait for the initial session connection to be established. (4 minutes)
    connectionRetryTimeout: 240000,
    connectionRetryCount: 1,
    capabilities: {
        alwaysMatch: {
            platformName: "Android",
            "appium:deviceName": "10.0.0.4:39183",
            "appium:automationName": "UiAutomator2",
            "appium:appPackage": "cn.tydic.ethiopay",
            "appium:appActivity": "com.huawei.module_basic_ui.splash.LauncherActivity",
            "appium:noReset": true,
            // ✅ STABILITY: How long Appium will wait for a new command before closing the session.
            // Increased to 10 minutes to handle very slow network conditions.
            "appium:newCommandTimeout": 600
        }
    }
};

// --- Centralized Selectors for Easy Maintenance ---
const SELECTORS = {
    LOGIN_NEXT_BTN: "id=cn.tydic.ethiopay:id/btn_next",
    LOGIN_PIN_KEYPAD: {
        "0": "id=cn.tydic.ethiopay:id/tv_input_0", "1": "id=cn.tydic.ethiopay:id/tv_input_1",
        "2": "id=cn.tydic.ethiopay:id/tv_input_2", "3": "id=cn.tydic.ethiopay:id/tv_input_3",
        "4": "id=cn.tydic.ethiopay:id/tv_input_4", "5": "id=cn.tydic.ethiopay:id/tv_input_5",
        "6": "id=cn.tydic.ethiopay:id/tv_input_6", "7": "id=cn.tydic.ethiopay:id/tv_input_7",
        "8": "id=cn.tydic.ethiopay:id/tv_input_8", "9": "id=cn.tydic.ethiopay:id/tv_input_9",
    },
    MAIN_PAGE_CONTAINER: "id=cn.tydic.ethiopay:id/rl_function_container",
    SEND_MONEY_BTN: 'android=new UiSelector().className("android.view.ViewGroup").clickable(true).instance(4)',
    SEND_MONEY_INDIVIDUAL_BTN: 'android=new UiSelector().className("android.view.ViewGroup").clickable(true).instance(0)',
    RECIPIENT_PHONE_INPUT: "id=cn.tydic.ethiopay:id/et_input",
    RECIPIENT_NEXT_BTN: "id=cn.tydic.ethiopay:id/btn_next",
    AMOUNT_INPUT: "id=cn.tydic.ethiopay:id/et_amount",
    CONFIRM_PAY_BTN: "id=cn.tydic.ethiopay:id/confirm",
    TRANSACTION_PIN_KEYPAD: (digit) => `android=new UiSelector().resourceId("cn.tydic.ethiopay:id/tv_key").text("${digit}")`,
    TRANSACTION_FINISHED_BTN: "id=cn.tydic.ethiopay:id/btn_confirm",
};


// --- Helper Functions ---

/**
 * Checks if an element is visible on screen within a given timeout.
 * @param {object} driver - The WebdriverIO driver instance.
 * @param {string} selector - The element selector.
 * @param {number} timeout - Timeout in milliseconds.
 * @returns {Promise<boolean>}
 */
async function isDisplayedWithin(driver, selector, timeout = 30000) { // Increased default timeout
    try {
        const element = await driver.$(selector);
        await element.waitForDisplayed({ timeout });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Enters a PIN into the appropriate keypad.
 * @param {object} driver - The WebdriverIO driver instance.
 * @param {string} pin - The PIN to enter.
 * @param {boolean} isTransactionPin - Whether to use the transaction PIN layout.
 */
async function enterPin(driver, pin, isTransactionPin = false) {
    console.log(`🔹 Entering ${isTransactionPin ? 'transaction' : 'login'} PIN...`);
    for (const digit of pin) {
        const selector = isTransactionPin ? SELECTORS.TRANSACTION_PIN_KEYPAD(digit) : SELECTORS.LOGIN_PIN_KEYPAD[digit];
        const btn = await driver.$(selector);
        await btn.click();
    }
}

/**
 * Intelligently navigates to the app's home screen regardless of the current state.
 * @param {object} driver - The WebdriverIO driver instance.
 */
async function navigateToHome(driver) {
    console.log("🧠 Checking app state and navigating to home screen...");

    if (await isDisplayedWithin(driver, SELECTORS.MAIN_PAGE_CONTAINER, 5000)) {
        console.log("✅ Already on the home screen.");
        return;
    }

    if (await isDisplayedWithin(driver, SELECTORS.LOGIN_NEXT_BTN, 3000)) {
        console.log("🔹 On login screen. Logging in...");
        await (await driver.$(SELECTORS.LOGIN_NEXT_BTN)).click();
    }

    if (await isDisplayedWithin(driver, SELECTORS.LOGIN_PIN_KEYPAD["1"], 3000)) {
        await enterPin(driver, TELEBIRR_LOGIN_PIN, false);
        await driver.$(SELECTORS.MAIN_PAGE_CONTAINER).waitForDisplayed({ timeout: 45000 }); // Longer wait for login
        console.log("✅ Login successful. On home screen.");
        return;
    }

    console.log("🔹 On an unknown screen. Attempting to go back to home...");
    for (let i = 0; i < 4; i++) {
        await driver.back();
        await driver.pause(1000); // Slightly longer pause for UI to settle
        if (await isDisplayedWithin(driver, SELECTORS.MAIN_PAGE_CONTAINER, 2000)) {
            console.log("✅ Successfully returned to home screen via back button.");
            return;
        }
    }

    throw new Error("FATAL: Could not navigate to the home screen after multiple attempts.");
}


// --- Main Worker Process ---

async function processTelebirrWithdrawal({ amount, account_number }) {
    let driver;
    const result = { status: "", message: "", data: null };

    try {
        driver = await wdio.remote(opts);
        console.log("✅ Appium session started.");

        await navigateToHome(driver);

        console.log("🔹 Navigating to 'Send Money'...");
        await (await driver.$(SELECTORS.SEND_MONEY_BTN)).click();
        await (await driver.$(SELECTORS.SEND_MONEY_INDIVIDUAL_BTN)).click();

        console.log("🔹 Entering recipient details...");
        const phoneInput = await driver.$(SELECTORS.RECIPIENT_PHONE_INPUT);
        await phoneInput.setValue(account_number);
        await (await driver.$(SELECTORS.RECIPIENT_NEXT_BTN)).click();

        console.log("🔹 Entering amount and confirming...");
        const amountInput = await driver.$(SELECTORS.AMOUNT_INPUT);
        await amountInput.setValue(String(amount));
        await (await driver.$(SELECTORS.CONFIRM_PAY_BTN)).click();

        console.log("🔹 Entering transaction PIN...");
        await enterPin(driver, TELEBIRR_LOGIN_PIN, true);
        await (await driver.$(SELECTORS.TRANSACTION_FINISHED_BTN)).click();

        console.log("✅ Transaction appears to be successful.");
        result.status = "success";
        result.message = "Transaction completed successfully";
        result.data = { phone: account_number, amount: amount };

    } catch (err) {
        console.error("❌ Error during automation:", err);
        // NOTE: Please verify the correct failure status for your database schema.
        // It could be "fail", "failed", "error", etc.
        result.status = "fail";
        result.message = err.message || "Unknown error";
        result.data = { error: err.toString() };
    } finally {
        if (driver) {
            console.log("🧹 Cleaning up session...");
            try {
                await navigateToHome(driver);
            } catch (cleanupErr) {
                console.warn("⚠️ Could not return to home during cleanup:", cleanupErr.message);
            }
            await driver.deleteSession();
            console.log("Session ended.");
        }
        console.log(JSON.stringify(result, null, 2));
        return result;
    }
}

module.exports = { processTelebirrWithdrawal };
