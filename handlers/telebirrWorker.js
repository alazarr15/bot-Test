// telebirrWorker_complete.js
// Worker process for handling Telebirr automation using WebdriverIO and Appium

const wdio = require("webdriverio");

// ⚠️ SECURITY: Use environment variables for sensitive info
const TELETIRR_LOGIN_PIN = process.env.TELEBIRR_LOGIN_PIN;
const TELETIRR_PHONE = process.env.TELEBIRR_PHONE;

if (!TELETIRR_LOGIN_PIN || !TELETIRR_PHONE) {
    throw new Error("Missing required environment variables: TELEBIRR_LOGIN_PIN or TELEBIRR_PHONE.");
}

// WebdriverIO/Appium options
const opts = {
    protocol: 'http',
    hostname: '188.245.100.132', // Appium server host
    port: 4723,
    path: '/wd/hub',
    capabilities: {
        alwaysMatch: {
            platformName: "Android",
            "appium:deviceName": "10.0.0.4:38999",
            "appium:automationName": "UiAutomator2",
            "appium:appPackage": "cn.tydic.ethiopay",
            "appium:appActivity": "com.huawei.module_basic_ui.splash.LauncherActivity",
            "appium:noReset": true,
            "appium:newCommandTimeout": 6000
        }
    }
};

// Keypad mapping for login PIN
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

// Enter PIN (login or transaction)
async function enterPin(driver, pin, isTransaction = false) {
    for (let digit of pin) {
        let btn;
        if (isTransaction) {
            btn = await driver.$(`android=new UiSelector().resourceId("cn.tydic.ethiopay:id/tv_key").text("${digit}")`);
        } else {
            btn = await driver.$(`id=${KEYPAD[digit]}`);
        }
        await btn.waitForDisplayed({ timeout: 10000 });
        await btn.click();
    }
}

// Detect current page
async function detectPage(driver) {
    try {
        if (await driver.$("id=cn.tydic.ethiopay:id/btn_next").isDisplayed().catch(() => false)) {
            return "login";
        }
        if (await driver.$("id=cn.tydic.ethiopay:id/rl_function_container").isDisplayed().catch(() => false)) {
            return "sendMoney";
        }
        if (await driver.$("id=cn.tydic.ethiopay:id/et_amount").isDisplayed().catch(() => false)) {
            return "amount";
        }
        if (await driver.$('android=new UiSelector().resourceId("cn.tydic.ethiopay:id/tv_key").text("1")').isDisplayed().catch(() => false)) {
            return "transactionPin";
        }
        return "unknown";
    } catch {
        return "unknown";
    }
}

// Main process
async function processTelebirrWithdrawal({ amount, account_number }) {
    let driver;
    const result = { status: "", message: "", data: null };

    try {
        driver = await wdio.remote(opts);
        console.log("✅ App launched successfully");

        let flowComplete = false;
        while (!flowComplete) {
            const page = await detectPage(driver);
            console.log("Current page:", page);

            switch (page) {
                case "login":
                    const loginNextBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_next");
                    await loginNextBtn.click();
                    await enterPin(driver, TELETIRR_LOGIN_PIN);
                    break;

                case "sendMoney":
                    const sendMoneyBtn = await driver.$("id=cn.tydic.ethiopay:id/rl_function_container");
                    await sendMoneyBtn.click();

                    const individualBtn = await driver.$("//android.view.ViewGroup[@clickable='true']");
                    await individualBtn.click();

                    const phoneInput = await driver.$("id=cn.tydic.ethiopay:id/et_input");
                    await phoneInput.setValue(account_number);

                    const nextPhoneBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_next");
                    await nextPhoneBtn.click();
                    break;

                case "amount":
                    const amountInputWrapper = await driver.$("id=cn.tydic.ethiopay:id/et_amount_click_view");
                    await amountInputWrapper.click();

                    const amountInput = await driver.$("id=cn.tydic.ethiopay:id/et_amount");
                    await amountInput.setValue(String(amount));

                    // Tap OK using coordinates if necessary
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
                    break;

                case "transactionPin":
                    await enterPin(driver, TELETIRR_LOGIN_PIN, true);
                    const finishedBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_confirm");
                    await finishedBtn.click();
                    flowComplete = true;
                    break;

                default:
                    throw new Error("Unknown page detected, cannot continue");
            }
        }

        result.status = "success";
        result.message = "Transaction completed successfully";
        result.data = { phone: account_number, amount: amount };
        console.log("✅ Transaction successful");

    } catch (err) {
        console.error("❌ Error:", err);
        result.status = "fail";
        result.message = err.message || "Unknown error";
        result.data = { error: err.toString() };
    } finally {
        if (driver) await driver.deleteSession();
        console.log("Session ended");
        return result;
    }
}

module.exports = { processTelebirrWithdrawal };