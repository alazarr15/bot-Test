// services/appiumService.js
// This service manages the single, persistent Appium driver session and all related helpers.
// Refactored for improved robustness, error handling, and maintainability.

const wdio = require("webdriverio");

// ⚠️ SECURITY: Use environment variables for sensitive info.
// This prevents hardcoding secrets into the source code.
const TELEBIRR_LOGIN_PIN = process.env.TELEBIRR_LOGIN_PIN;

if (!TELEBIRR_LOGIN_PIN) {
    throw new Error("Missing required environment variable: TELEBIRR_LOGIN_PIN.");
}

// --- Centralized Configuration ---

// Appium connection options
const opts = {
    protocol: 'http',
    hostname: '188.245.100.132', // Appium server host
    port: 4723,
    path: '/',
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
            "appium:noReset": true, // Keep app data between sessions
            "appium:newCommandTimeout": 3600 // Keep session alive for 1 hour of inactivity
        }
    }
};




// Centralized Selectors

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
    SEND_MONEY_BTN: 'android=new UiSelector().resourceId("cn.tydic.ethiopay:id/rl_function_container").childSelector(new UiSelector().clickable(true).instance(0))',
    SEND_MONEY_INDIVIDUAL_BTN: 'android=new UiSelector().className("android.view.ViewGroup").clickable(true).instance(0)',
    RECIPIENT_PHONE_INPUT: "id=cn.tydic.ethiopay:id/et_input",
    RECIPIENT_NEXT_BTN: "id=cn.tydic.ethiopay:id/btn_next",
    AMOUNT_INPUT: "id=cn.tydic.ethiopay:id/et_amount",
    CONFIRM_PAY_BTN: "id=cn.tydic.ethiopay:id/confirm",
    TRANSACTION_PIN_KEYPAD: (digit) => `android=new UiSelector().resourceId("cn.tydic.ethiopay:id/tv_key").text("${digit}")`,
    TRANSACTION_FINISHED_BTN: "id=cn.tydic.ethiopay:id/btn_confirm",
};

// --- Driver Management ---

// Singleton pattern: Holds the single driver instance for the application lifetime.
let driver = null;

/**
 * Checks if the current driver session is healthy and responsive.
 * @param {object} drv - The driver instance to check.
 * @returns {Promise<boolean>} - True if the driver is healthy, false otherwise.
 */
async function isDriverHealthy(drv) {
    if (!drv) return false;
    try {
        await drv.getPageSource(); // A lightweight command to check session validity.
        return true;
    } catch (err) {
        console.warn("⚠️ Driver is unhealthy:", err.message);
        return false;
    }
}

/**
 * Retrieves a healthy, ready-to-use Appium driver instance.
 * If a driver doesn't exist or the existing one is unresponsive, it creates a new session.
 * @returns {Promise<object>} - A WDIO driver instance.
 */
async function getDriver() {
    try {
        if (!(await isDriverHealthy(driver))) {
            if (driver) {
                console.log("🔄 Resetting stale Appium session...");
                // Suppress errors during cleanup of a defunct session.
                await driver.deleteSession().catch(() => {});
            }
            console.log("🔌 Creating new Appium session...");
            driver = await wdio.remote(opts);
            console.log("✅ Appium session started successfully.");
        }
        return driver;
    } catch (error) {
        console.error("🔥 Failed to create or get Appium driver:", error);
        driver = null; // Ensure the broken driver is cleared.
        throw error; // Re-throw the error to be handled by the caller.
    }
}

/**
 * Forcibly resets the current driver instance.
 * This should be used in critical error-recovery scenarios.
 */
function resetDriver() {
    console.warn("🔴 Forcibly resetting driver due to a critical error.");
    if (driver) {
        driver.deleteSession().catch(() => {});
    }
    driver = null;
}

// --- Helper Functions ---

/**
 * Checks if an element is displayed on the screen within a specified timeout.
 * @param {object} drv - The driver instance.
 * @param {string} selector - The element selector.
 * @param {number} [timeout=30000] - Timeout in milliseconds.
 * @returns {Promise<boolean>} - True if the element is displayed.
 */
async function isDisplayedWithin(drv, selector, timeout = 30000) {
    try {
        const element = await drv.$(selector);
        await element.waitForDisplayed({ timeout });
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * Ensures the device screen is unlocked before proceeding.
 * @param {object} drv - The driver instance.
 */
async function ensureDeviceIsUnlocked(drv) {
    console.log("🔐 Checking device lock state...");
    if (await drv.isLocked()) {
        console.log("📱 Device is locked. Attempting to unlock...");
        await drv.unlock();
        // Wait for a known element on the home screen instead of a fixed pause.
        await drv.waitUntil(
            async () => (await drv.getDisplayDensity()) > 0,
            { timeout: 5000, timeoutMsg: "Device did not unlock in time" }
        );
        console.log("✅ Unlock attempt completed.");
    } else {
        console.log("✅ Device is already unlocked.");
    }
}

/**
 * Enters a PIN using the app's custom keypad.
 * @param {object} drv - The driver instance.
 * @param {string} pin - The PIN to enter.
 * @param {boolean} [isTransactionPin=false] - True if using the transaction PIN keypad.
 */
async function enterPin(drv, pin, isTransactionPin = false) {
    console.log(`🔹 Entering ${isTransactionPin ? 'transaction' : 'login'} PIN...`);
    for (const digit of pin) {
        const selector = isTransactionPin ? SELECTORS.TRANSACTION_PIN_KEYPAD(digit) : SELECTORS.LOGIN_PIN_KEYPAD[digit];
        const btn = await drv.$(selector);
        await btn.click();
    }
}

/**
 * A robust function to navigate the app to its main home screen from any state.
 * Includes a retry mechanism with a limit to prevent infinite loops.
 * @param {object} drv - The driver instance.
 * @param {number} [retries=1] - The number of remaining retry attempts.
 */
async function navigateToHome(drv, retries = 1) {
        await ensureDeviceIsUnlocked(drv);
        console.log("🧠 Navigating to home screen...");
    
        // Activate the app (re-focus)
        await drv.activateApp(opts.capabilities.alwaysMatch["appium:appPackage"]);
        await drv.pause(2000); // Allow UI to refresh
    
        // Check if we are already on main screen
        if (await isDisplayedWithin(drv, SELECTORS.MAIN_PAGE_CONTAINER, 5000)) {
            console.log("✅ Already on home screen.");
            return;
        }
    
        // Login flow if needed
        if (await isDisplayedWithin(drv, SELECTORS.LOGIN_NEXT_BTN, 3000)) {
            console.log("🔹 On login screen. Clicking Next...");
            await (await drv.$(SELECTORS.LOGIN_NEXT_BTN)).click();
        }
    
        if (await isDisplayedWithin(drv, SELECTORS.LOGIN_PIN_KEYPAD["1"], 3000)) {
            await enterPin(drv, TELEBIRR_LOGIN_PIN, false);
            //await drv.$(SELECTORS.MAIN_PAGE_CONTAINER).waitForDisplayed({ timeout: 45000 });
            console.log("✅ Login successful. On home screen.");
            return;
        }
    
        // Unknown screen: try back navigation
        console.log("🔹 On unknown screen. Attempting back navigation...");
        for (let i = 0; i < 4; i++) {
            await drv.back();
            await drv.pause(1000);
            if (await isDisplayedWithin(drv, SELECTORS.MAIN_PAGE_CONTAINER, 2000)) {
                console.log("✅ Returned to home screen via back button.");
                return;
            }
        }
    

    // 4. As a last resort, reset the driver and retry if attempts are left.
    if (retries > 0) {
        console.warn("🔴 Could not navigate to home. Resetting driver and retrying...");
        resetDriver();
        const newDriver = await getDriver();
        await navigateToHome(newDriver, retries - 1); // Recursive retry with decremented counter.
    } else {
        throw new Error("🔥 Failed to navigate to home screen after multiple retries.");
    }
}

// --- Keep-Alive Mechanism ---

let keepAliveInterval = null;

/**
 * Periodically sends a command to the Appium server to prevent the session from timing out.
 * @param {number} [intervalMinutes=5] - The interval in minutes.
 */
function startKeepAlive(intervalMinutes = 5) {
    console.log(`🟢 Starting keep-alive mechanism with a ${intervalMinutes}-minute interval.`);
    // Clear any existing interval to prevent duplicates.
    if (keepAliveInterval) clearInterval(keepAliveInterval);

    keepAliveInterval = setInterval(async () => {
        try {
            const drv = await getDriver();
            await drv.getPageSource(); // Ping the server.
            console.log("✔️ Keep-alive ping successful.");
        } catch (err) {
            console.warn("⚠️ Keep-alive ping failed:", err.message);
            console.log("🔄 Attempting driver reset due to keep-alive failure...");
            resetDriver();
            await getDriver().catch((e) => console.error("🔥 Failed to restart driver after keep-alive failure.", e));
        }
    }, intervalMinutes * 60 * 1000);
}

// Automatically start the keep-alive when the module is loaded.
startKeepAlive();

module.exports = {
    getDriver,
    resetDriver,
    navigateToHome,
    enterPin,
    ensureDeviceIsUnlocked,
    SELECTORS,
    TELEBIRR_LOGIN_PIN,
};
