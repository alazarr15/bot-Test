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

// Helper to enter login or transaction PIN
async function enterPin(driver, pin, isTransactionPin = false) {
    const pinType = isTransactionPin ? "Transaction" : "Login";
    console.log(`Entering ${pinType} PIN...`);

    for (let digit of pin) {
        console.log(`Clicking button for digit: ${digit}`);
        let btn;
        if (isTransactionPin) {
            btn = await driver.$(`android=new UiSelector().resourceId("cn.tydic.ethiopay:id/tv_key").text("${digit}")`);
        } else {
            btn = await driver.$(`id=${KEYPAD[digit]}`);
        }
        await btn.waitForExist({ timeoutMsg: `PIN button for digit ${digit} not found` });
        await btn.click();
    }

    console.log(`${pinType} PIN entered successfully.`);
}

// Helper to detect which page is currently displayed
async function detectPage(driver) {
    if (await driver.$("id=cn.tydic.ethiopay:id/btn_next").isDisplayed().catch(() => false)) {
        return "login";
    }

    if (await driver.$("id=cn.tydic.ethiopay:id/et_amount").isDisplayed().catch(() => false)) {
        return "amount";
    }

    if (await driver.$('android=new UiSelector().resourceId("cn.tydic.ethiopay:id/tv_key").text("1")').isDisplayed().catch(() => false)) {
        return "transactionPin";
    }

    if (await driver.$("id=cn.tydic.ethiopay:id/rl_function_container").isDisplayed().catch(() => false)) {
        return "sendMoney";
    }

    return "unknown";
}

// Main function to process Telebirr withdrawal
async function processTelebirrWithdrawal({ amount, account_number }) {
    let driver;
    const result = { status: "", message: "", data: null };

    try {
        console.log("Starting WebdriverIO session...");
        driver = await wdio.remote(opts);
        console.log("✅ App launched successfully");

        // Dynamic flow loop using detectPage
        let flowComplete = false;
        while (!flowComplete) {
            const currentPage = await detectPage(driver);

            switch (currentPage) {
                case "login":
                    console.log("🔹 Login page detected");
                    const loginNextBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_next");
                    await loginNextBtn.waitForExist();
                    await loginNextBtn.click();
                    await enterPin(driver, TELETIRR_LOGIN_PIN, false);
                    break;

                case "sendMoney":
                    console.log("🔹 Send Money page detected");
                    const sendMoneyBtn = await driver.$("id=cn.tydic.ethiopay:id/rl_function_container");
                    await sendMoneyBtn.waitForExist();
                    await sendMoneyBtn.click();

                    const individualBtn = await driver.$("//android.widget.TextView[@resource-id='cn.tydic.ethiopay:id/title' and @text='Individual recipient']");
                    await individualBtn.waitForExist();
                    await individualBtn.click();

                    const phoneInput = await driver.$("id=cn.tydic.ethiopay:id/et_input");
                    await phoneInput.waitForExist();
                    await phoneInput.setValue(account_number);

                    const nextPhoneBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_next");
                    await nextPhoneBtn.waitForExist();
                    await nextPhoneBtn.click();
                    break;

                case "amount":
                    console.log("🔹 Amount page detected");
                    const amountInputWrapper = await driver.$("id=cn.tydic.ethiopay:id/et_amount_click_view");
                    await amountInputWrapper.waitForExist();
                    await amountInputWrapper.click();

                    const amountInput = await driver.$("id=cn.tydic.ethiopay:id/et_amount");
                    await amountInput.waitForExist();
                    await amountInput.setValue(String(amount));

                    const okButton = await driver.$(`android=new UiSelector().resourceId("cn.tydic.ethiopay:id/btn_ok")`);
                    await okButton.waitForExist();
                    await okButton.click();

                    const sendBtn = await driver.$("id=cn.tydic.ethiopay:id/confirm");
                    await sendBtn.waitForExist();
                    await sendBtn.click();
                    break;

                case "transactionPin":
                    console.log("🔹 Transaction PIN page detected");
                    await enterPin(driver, TELETIRR_LOGIN_PIN, true);

                    const finishedBtn = await driver.$("id=cn.tydic.ethiopay:id/btn_confirm");
                    await finishedBtn.waitForExist();
                    await finishedBtn.click();
                    flowComplete = true;
                    break;

                default:
                    throw new Error("Unknown page detected, cannot continue automation");
            }
        }

        result.status = "success";
        result.message = "Transaction completed successfully";
        result.data = { phone: account_number, amount: amount, tx_ref: `telebirr_tx_${Date.now()}` };
        console.log("🚀 Transaction successful", result.data);

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

    return result;
}

// Export the function
module.exports = { processTelebirrWithdrawal };
