// telebirrWorker_final.js
// VERSION 6.0 - Added screen wake and unlock functionality.

const wdio = require("webdriverio");

// ⚠️ SECURITY: Use environment variables for sensitive info
const TELEBIRR_LOGIN_PIN = process.env.TELEBIRR_LOGIN_PIN;
const TELEBIRR_PHONE = process.env.TELEBIRR_PHONE;
const APPIUM_DEVICE_NAME = process.env.APPIUM_DEVICE_NAME;

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
            "appium:deviceName": "myPhone",
            "appium:udid": "10.0.0.4:5555",
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
    SEND_MONEY_BTN: 'android=new UiSelector().className("android.view.ViewGroup").clickable(true).instance(0)',
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
 * ⭐️ NEW: Wakes the device and performs a swipe to unlock if it's locked.
 * This runs before any app interaction to ensure the device is ready.
 * @param {object} driver - The WebdriverIO driver instance.
 */
async function ensureDeviceIsUnlocked(driver) {
    console.log("🔐 Checking device lock state...");
    const isLocked = await driver.isDeviceLocked();

    if (isLocked) {
        console.log("📱 Device is locked. Attempting to wake and unlock...");
        await driver.wake(); // Wakes the device (equivalent to pressing the power button)
        await driver.pause(1000); // Wait a moment for the lock screen UI to load

        // Get screen dimensions to perform a generic "swipe up" unlock
        const { width, height } = await driver.getWindowRect();
        const startX = width / 2;
        const startY = height * 0.8; // Start swipe from 80% down the screen
        const endY = height * 0.2;   // End swipe at 20% from the top

        console.log(`💨 Performing unlock swipe from (${startX.toFixed(0)}, ${startY.toFixed(0)}) to (${startX.toFixed(0)}, ${endY.toFixed(0)})`);

        // Perform the swipe action
        await driver.performActions([{
            type: 'pointer',
            id: 'finger1',
            parameters: { pointerType: 'touch' },
            actions: [
                { type: 'pointerMove', duration: 0, x: startX, y: startY },
                { type: 'pointerDown', button: 0 },
                { type: 'pointerMove', duration: 500, x: startX, y: endY }, // A 500ms swipe
                { type: 'pointerUp', button: 0 }
            ]
        }]);
        await driver.releaseActions();
        await driver.pause(2000); // Wait for the home screen to settle after unlock
        console.log("✅ Unlock attempt completed.");
    } else {
        console.log("✅ Device is already unlocked.");
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

        // ⭐️ NEW: Ensure the device is awake and unlocked before proceeding.
        await ensureDeviceIsUnlocked(driver);

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
                // No need to navigate home here as the session is ending,
                // but we still want to ensure the session closes cleanly.
                // await navigateToHome(driver); 
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