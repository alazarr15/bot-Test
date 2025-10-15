// services/appiumService.js
// This service manages the single, persistent Appium driver session and all related helpers.

const wdio = require("webdriverio");

// ⚠️ SECURITY: Use environment variables for sensitive info
const TELEBIRR_LOGIN_PIN = process.env.TELEBIRR_LOGIN_PIN;

if (!TELEBIRR_LOGIN_PIN) {
    throw new Error("Missing required environment variable: TELEBIRR_LOGIN_PIN.");
}

// Centralized Appium options
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
            // 💡 Changed to a less specific activity to improve startup stability
            "appium:appActivity": "com.huawei.module_basic_ui.splash.LauncherActivity", 
            "appium:noReset": true,
            "appium:newCommandTimeout": 3600,
            "appium:adbExecTimeout": 120000
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
    SEND_MONEY_BTN: 'android=new UiSelector().className("android.view.ViewGroup").clickable(true).instance(0)',
    SEND_MONEY_INDIVIDUAL_BTN: 'android=new UiSelector().className("android.view.ViewGroup").clickable(true).instance(0)',
    RECIPIENT_PHONE_INPUT: "id=cn.tydic.ethiopay:id/et_input",
    RECIPIENT_NEXT_BTN: "id=cn.tydic.ethiopay:id/btn_next",
    AMOUNT_INPUT: "id=cn.tydic.ethiopay:id/et_amount",
    CONFIRM_PAY_BTN: "id=cn.tydic.ethiopay:id/confirm",
    TRANSACTION_PIN_KEYPAD: (digit) => `android=new UiSelector().resourceId("cn.tydic.ethiopay:id/tv_key").text("${digit}")`,
    TRANSACTION_FINISHED_BTN: "id=cn.tydic.ethiopay:id/btn_confirm",
    // Add specific selectors for any modals or errors that might appear before login/home
    WELCOME_SCREEN_BTN: "id=cn.tydic.ethiopay:id/btn_next" 
};

// --- Driver Management (Unchanged) ---
let driver = null;

async function getDriver() {
    try {
        let needsNewSession = false;
        if (!driver) {
            console.log("🔌 No driver found. Creating new Appium session...");
            needsNewSession = true;
        } else {
            try {
                await driver.status();
                if (!driver.sessionId) {
                    console.warn("⚠️ Driver exists but no sessionId. Marking for reconnect...");
                    needsNewSession = true;
                }
            } catch (err) {
                console.warn("⚠️ Driver session seems stale:", err.message);
                needsNewSession = true;
            }
        }

        if (needsNewSession) {
            if (driver) {
                try {
                    await driver.deleteSession();
                } catch (e) {
                    console.error("Error cleaning old driver session:", e.message);
                }
            }
            driver = await wdio.remote(opts);
            console.log(`✅ Started new Appium session (id: ${driver.sessionId}).`);
        }
        return driver;
    } catch (error) {
        console.error("🔥 getDriver() failed:", error.message);
        driver = null;
        throw error;
    }
}

function resetDriver() {
    console.warn("🔴 Resetting driver due to a critical error.");
    driver = null;
}

// 💡 IMPROVED safeAction to handle UIA2 Crashes
async function safeAction(actionFn) {
    try {
        const d = await getDriver();
        return await actionFn(d);
    } catch (err) {
        // Specific check for UIA2 instrumentation crash
        if (err.message && err.message.includes("instrumentation process is not running")) {
            console.warn("💥 UIA2 Crash detected. Forcing driver reset and retrying once...");
            resetDriver();
            const d = await getDriver();
            await d.pause(5000); // CRITICAL: Pause for UIA2 to re-initialize
            return await actionFn(d); // Retry once
        }

        // Existing session ID check for general disconnects
        if (err.message && err.message.includes("invalid session id")) {
            console.warn("🔄 Session died. Reconnecting and retrying once...");
            resetDriver();
            const d = await getDriver();
            return await actionFn(d); // retry once
        }
        throw err;
    }
}


// --- Page Object Model (POM) Classes ---

/**
 * Base Page class to handle shared functionality like detection
 */
class BasePage {
    constructor(driver, pageName) {
        this.driver = driver;
        this.pageName = pageName;
    }

    /**
     * Attempts to find a unique, defining element for the page.
     * @param {string} selector - The unique element selector for the page.
     * @returns {boolean} True if the element is displayed, otherwise false (suppresses element not found errors).
     */
    async isDisplayed(selector) {
        try {
            // Use a short, non-critical timeout for quick detection
            const element = await this.driver.$(selector);
            return await element.waitForDisplayed({ timeout: 2000, interval: 500, reverse: false });
        } catch (e) {
            // Suppress "element not found" and timeout errors, which is normal for detection
            return false;
        }
    }
}

/** Represents the main application Home screen. */
class HomePage extends BasePage {
    constructor(driver) { super(driver, 'Home_Page'); }
    get mainContainer() { return SELECTORS.MAIN_PAGE_CONTAINER; }
    async isCurrentPage() {
        return await this.isDisplayed(this.mainContainer);
    }
}

/** Represents the initial Login/PIN entry screen. */
class LoginPage extends BasePage {
    constructor(driver) { super(driver, 'Login_Page'); }
    // We use the first keypad button as a unique identifier for the PIN entry state
    get pinKeypad() { return SELECTORS.LOGIN_PIN_KEYPAD["1"]; } 
    get nextButton() { return SELECTORS.LOGIN_NEXT_BTN; }

    async isCurrentPage() {
        // Check for the PIN keypad, which is the final step before Home
        return await this.isDisplayed(this.pinKeypad);
    }

    async isWelcomeScreen() {
        // Check for the first "next" button if the app shows a setup flow first
        return await this.isDisplayed(this.nextButton);
    }
}

// --- Page Detector Service ---

/** A list of all known pages/states and their unique identifiers/actions */
const PAGE_STATES = [
    { name: 'Home_Page', page: HomePage },
    { name: 'Login_Page', page: LoginPage },
    // Add other states (e.g., 'Update_Modal_Page', 'Network_Error_Page') here
];

/**
 * Checks the current screen state by iterating through all known pages.
 * @param {WebdriverIO.Browser} driver - The current driver instance.
 * @returns {string} The name of the detected page or 'Unknown'.
 */
async function getCurrentPageState(driver) {
    const pages = {
        home: new HomePage(driver),
        login: new LoginPage(driver)
    };
    
    // Check for the most desirable state first (Home)
    if (await pages.home.isCurrentPage()) return 'Home_Page';
    
    // Check for login states
    if (await pages.login.isCurrentPage()) return 'Login_PIN';
    if (await pages.login.isWelcomeScreen()) return 'Welcome_Screen';
    
    // Check for other defined states (not implemented in this snippet)
    
    return 'Unknown';
}


// --- Helper Functions (Updated) ---

async function isDisplayedWithin(driver, selector, timeout = 30000) {
    try {
        const element = await driver.$(selector);
        // 💡 CRITICAL: Ensure we throw if UIA2 crashes here, not just return false.
        await element.waitForDisplayed({ timeout, interval: 500 }); 
        return true;
    } catch (e) {
        // Only return false if the specific error is 'element not found' or 'timeout'
        if (e.message.includes('element could not be located') || e.message.includes('timeout')) {
            return false;
        }
        // Re-throw other critical errors (like UIA2 crash)
        throw e;
    }
}

async function ensureDeviceIsUnlocked() {
    // ... (implementation is unchanged)
    return safeAction(async (driver) => {
        console.log("🔐 Checking device lock state...");
        const isLocked = await driver.isLocked();
        if (isLocked) {
            console.log("📱 Device is locked. Attempting to unlock...");
            await driver.unlock();
            await driver.pause(2000);
            console.log("✅ Device should now be unlocked.");
        } else {
            console.log("✅ Device is already unlocked.");
        }
    });
}


async function enterPin(driver, pin, isTransactionPin = false) {
    console.log(`🔹 Entering ${isTransactionPin ? 'transaction' : 'login'} PIN...`);
    for (const digit of pin) {
        const selector = isTransactionPin 
            ? SELECTORS.TRANSACTION_PIN_KEYPAD(digit) 
            : SELECTORS.LOGIN_PIN_KEYPAD[digit];
        const btn = await driver.$(selector);
        await btn.click();
    }
}

// --- Main Automation Flows (Refactored) ---

async function navigateToHome() {
    return safeAction(async (driver) => {
        await ensureDeviceIsUnlocked();
        await driver.pause(1500); // Wait for UIA2 to fully settle after unlock/initialization

        console.log("🧠 Checking app state and navigating to home screen...");
        const appPackage = opts.capabilities.alwaysMatch["appium:appPackage"];

        for (let attempt = 1; attempt <= 3; attempt++) {
            
            // 1. DETECT THE CURRENT STATE
            const currentState = await getCurrentPageState(driver);
            console.log(`[Attempt ${attempt}] Current state detected: ${currentState}`);

            switch (currentState) {
                case 'Home_Page':
                    console.log("✅ Already on the home screen.");
                    return; // EXIT: Success

                case 'Login_PIN':
                    console.log("🔹 On login PIN entry screen. Logging in...");
                    await enterPin(driver, TELEBIRR_LOGIN_PIN, false);
                    // Wait for the Home container to load, with a reduced, safe timeout
                    await driver.$(SELECTORS.MAIN_PAGE_CONTAINER).waitForDisplayed({ timeout: 20000 });
                    console.log("✅ Login successful. On home screen.");
                    return; // EXIT: Success

                case 'Welcome_Screen':
                    console.log("🔹 On welcome screen. Tapping next to proceed to PIN...");
                    await (await driver.$(SELECTORS.WELCOME_SCREEN_BTN)).click();
                    break; // Loop again to detect the new state (Login_PIN)

                case 'Unknown':
                default:
                    console.log("❓ Unknown/Unstable state. Attempting app foreground and cleanup...");
                    
                    // Force the app to the foreground (Activates if backgrounded/crashed)
                    await driver.activateApp(appPackage);
                    await driver.pause(2000); 

                    // Aggressively try to dismiss potential modals/popups
                    for (let i = 0; i < 2; i++) {
                        try {
                            await driver.back(); 
                            await driver.pause(1000);
                        } catch (e) {
                             // Ignore failure on 'back' command
                        }
                    }
                    break; // Loop again to re-detect the state
            }
            
            if (attempt === 3 && currentState !== 'Home_Page') {
                throw new Error(`FATAL: Could not navigate to home screen after ${attempt} attempts. Final state: ${currentState}`);
            }
        }
    });
}


setInterval(async () => {
    try {
        const d = await getDriver();
        await d.getPageSource(); // lightweight call to keep session alive
    } catch (e) {
        console.warn("Heartbeat failed, driver will be reset:", e.message);
        resetDriver();
    }
}, 4 * 60 * 1000); 


module.exports = {
    getDriver,
    resetDriver,
    navigateToHome,
    // Raw version: expects a driver (for internal use)
    enterPinRaw: enterPin, 
    // Driverless version: wraps safeAction, safe for external calls
    enterPin: (pin, isTransactionPin) => safeAction(async (d) => enterPin(d, pin, isTransactionPin)),
    ensureDeviceIsUnlocked,
    SELECTORS,
    TELEBIRR_LOGIN_PIN,
    safeAction
};
