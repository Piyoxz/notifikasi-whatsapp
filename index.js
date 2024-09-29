const fs = require("fs-extra");
const axios = require("axios");

let config = JSON.parse(fs.readFileSync("./configData.json"));
var serviceAccount = require("./login.json");
let notification = JSON.parse(fs.readFileSync("./notification.json"));

const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: "testpiyo-b85e8",
});

const db = admin.firestore();

let previousData = JSON.parse(fs.readFileSync("./previousData.json"));

const timings = [
  { name: "Fajr" },
  { name: "Dhuhr" },
  { name: "Asr" },
  { name: "Maghrib" },
  { name: "Isha" },
];

const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  makeInMemoryStore,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const moment = require("moment-timezone");
moment.tz.setDefault("Asia/Jakarta").locale("id");

const chalk = require("chalk");

// const store = makeInMemoryStore({
//   logger: pino().child({ level: "silent", stream: "store" }),
// });

// const storeFilePath = "./baileys_store.json";

// store?.readFromFile(storeFilePath);

let currentIndex = 0;
const batchSize = 20;
let batchSizePrayer = 20;
let currentIndexPrayer = 0;

// setInterval(() => {
//   store.writeToFile(storeFilePath);
// }, 15_000);

const hasLocationChanged = (phoneNumber, newLat, newLng) => {
  if (!previousData[phoneNumber]) {
    previousData[phoneNumber] = { lat: newLat, lng: newLng };
    fs.writeFileSync(
      "./previousData.json",
      JSON.stringify(previousData, null, 2)
    );
    return true;
  }

  const { lat: oldLat, lng: oldLng } = previousData[phoneNumber];

  if (newLat !== oldLat || newLng !== oldLng) {
    previousData[phoneNumber] = { lat: newLat, lng: newLng };
    fs.writeFileSync(
      "./previousData.json",
      JSON.stringify(previousData, null, 2)
    );
    return true;
  }

  return false;
};

function resetAllNotifications() {
  for (let phoneNumber in notification) {
    notification[phoneNumber] = {
      25: false,
      50: false,
      75: false,
    };
  }

  fs.writeFileSync(
    "./notification.json",
    JSON.stringify(notification, null, 2)
  );
}

async function writeNotification(notification) {
  await fs.writeFileSync(
    "./notification.json",
    JSON.stringify(notification, null, 2)
  );
}

const start = async () => {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(`./piyobot`);
    __path = process.cwd();

    const conn = makeWASocket({
      logger: pino({ level: "silent" }),
      printQRInTerminal: true,
      auth: state,
      qrTimeout: 30_000,
      // getMessage: async (key) => {
      //   if (store) {
      //     const msg = await store.loadMessage(key.remoteJid, key.id);
      //     return msg?.message || undefined;
      //   }
      //   return {
      //     conversation: "hello",
      //   };
      // },
      printQRInTerminal: true,
    });

    conn.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === "close") {
        lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut
          ? start()
          : console.log("Koneksi Terputus...");
      } else if (connection === "connecting") {
        console.log("Menghubungkan...");
      } else if (connection === "open") {
        console.log("Terhubung...");
      }
    });

    conn.ev.on("creds.update", saveCreds);

    // store.bind(conn.ev);

    return conn;
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

let prayerTimes = JSON.parse(fs.readFileSync("./prayerTimes.json"));

async function startApp() {
  const conn = await start();

  resetAllNotifications();

  const updatePrayerTime = (userId, timings) => {
    const now = new Date();

    const createTime = (timeString) => {
      const [hours, minutes] = timeString.split(":").map(Number);
      const date = new Date(now);
      date.setHours(hours, minutes, 0, 0);
      return date;
    };

    const fajrTime = createTime(timings.Fajr);
    const dhuhrTime = createTime(timings.Dhuhr);
    const asrTime = createTime(timings.Asr);
    const maghribTime = createTime(timings.Maghrib);
    const ishaTime = createTime(timings.Isha);

    const prayerTimes = [
      { name: "Fajr", time: fajrTime, stringTime: timings.Fajr },
      { name: "Dhuhr", time: dhuhrTime, stringTime: timings.Dhuhr },
      { name: "Asr", time: asrTime, stringTime: timings.Asr },
      { name: "Maghrib", time: maghribTime, stringTime: timings.Maghrib },
      { name: "Isha", time: ishaTime, stringTime: timings.Isha },
    ];

    let closestPrayer = prayerTimes.find((prayer) => now < prayer.time);
    if (!closestPrayer) {
      closestPrayer = prayerTimes[0];
    }

    config[userId] = {
      currentPrayerTimes: {
        name: closestPrayer.name,
        time: closestPrayer.stringTime,
      },
    };

    fs.writeFileSync("./configData.json", JSON.stringify(config, null, 2));
  };

  const getAllUsers = async () => {
    try {
      const documents = await db.collection("users").listDocuments();

      let dataUsers = [];
      try {
        dataUsers = JSON.parse(fs.readFileSync("./users.json"));
      } catch (error) {
        console.error("Error reading users.json:", error);
      }

      for (const doc of documents) {
        const getCollection = await doc.collection("information").get();

        const newUserData = getCollection.docs.map((doc) => doc.data())[1];

        for (const user of dataUsers) {
          if (user[1].phoneNumber === newUserData.phoneNumber) {
            const existingIndex = dataUsers.findIndex(
              (user) => user[1].phoneNumber === newUserData.phoneNumber
            );
            if (existingIndex !== -1) {
              dataUsers.splice(existingIndex, 1);
            }
            break;
          }
        }
        dataUsers.push(getCollection.docs.map((doc) => doc.data()));
      }

      fs.writeFileSync("./users.json", JSON.stringify(dataUsers, null, 2));
    } catch (error) {
      console.error("Error getting users:", error);
    }
  };

  const getPrayerTimes = async (userId, lat, Lng) => {
    try {
      let { data } = await axios.get(
        `https://api.aladhan.com/v1/timings?latitude=${lat}&longitude=${Lng}&method=2`
      );

      prayerTimes[userId] = data.data.timings;

      fs.writeFileSync(
        "./prayerTimes.json",
        JSON.stringify(prayerTimes, null, 2)
      );

      return prayerTimes;
    } catch (error) {
      console.error(`Error getting prayer times for User ID: ${userId}`, error);
    }
  };

  const sendNotification = async (
    title,
    body,
    userId,
    latestPrayerName,
    percentage
  ) => {
    let numberReplace = userId.replace(/\D/g, "");
    if (numberReplace.startsWith("08")) {
      numberReplace = numberReplace.replace("08", "628");
    } else if (numberReplace.startsWith("8")) {
      numberReplace = "628" + numberReplace.slice(1);
    }
    const logMessage = `
    ${chalk.bold.green("╭───────────────────────────────────────────────")}
    ${chalk.blue.bold("│            Sending Notification               │")}
    ${chalk.bold.green("├───────────────────────────────────────────────")}
    ${chalk.green("│ User ID:")} ${userId}
    ${chalk.green("│ Latest Prayer Name:")} ${latestPrayerName}
    ${chalk.green("│ Percentage:")} ${percentage}%
    ${chalk.yellow("│ Formatted Number:")} ${numberReplace}
    ${chalk.bold.green("╰───────────────────────────────────────────────")}
      `;

    console.log(logMessage);

    await conn.sendMessage(numberReplace + "@s.whatsapp.net", {
      text: `${title}\n${body}`,
    });
  };

  const getUserDataPremium = async (userId) => {
    try {
      let dataUsers = JSON.parse(fs.readFileSync("./users.json"));

      let premium = false;

      for (let i = 0; i < dataUsers.length; i++) {
        const user = dataUsers[i][1];

        if (user.phoneNumber == userId) {
          premium = user.isPremium;
          break;
        }
      }

      return premium;
    } catch (error) {
      console.error(`Error getting user data for User ID: ${userId}`, error);
    }
  };

  async function checkNotification(userId) {
    if (config[userId].currentPrayerTime == {}) return;
    const now = new Date();
    const prayerTime = new Date(now);
    const [hours, minutes] = config[userId].currentPrayerTimes.time
      .split(":")
      .map(Number);
    prayerTime.setHours(hours, minutes, 0, 0);
    const latestPrayerTime = new Date(now);
    let latestPrayerName = "Fajr";
    timings.forEach((timing) => {
      const time = new Date(now);
      const [hours, minutes] = prayerTimes[userId][timing.name]
        .split(":")
        .map(Number);
      time.setHours(hours, minutes, 0, 0);
      if (time < now) {
        latestPrayerTime.setHours(hours, minutes, 0, 0);
        latestPrayerName = timing.name;
      }
    });
    const [latestHours, latestMinutes] = prayerTimes[userId][latestPrayerName]
      .split(":")
      .map(Number);
    latestPrayerTime.setHours(latestHours, latestMinutes, 0, 0);
    if (config[userId].currentPrayerTimes.name == "Fajr" && now > prayerTime) {
      prayerTime.setDate(prayerTime.getDate() + 1);
    }
    const diff = now.getTime() - prayerTime.getTime();
    const diffPercentage =
      (diff / (latestPrayerTime.getTime() - prayerTime.getTime())) * 100;
    if (await getUserDataPremium(userId)) {
      [75, 50, 25].forEach(async (percentage) => {
        if (diffPercentage.toFixed(0) == percentage) {
          const alreadyNotified = notification[userId]?.[percentage];
          if (!alreadyNotified) {
            notification[userId] = {
              ...notification[userId],
              [percentage]: true,
            };
            fs.writeFileSync(
              "./notification.json",
              JSON.stringify(notification, null, 2)
            );
            sendNotification(
              `Reminder ${config[userId].currentPrayerTimes.name}`,
              `Waktu Shalat ${config[userId].currentPrayerTimes.name} akan tiba`,
              userId,
              latestPrayerName,
              percentage
            );
          }
        }
      });
      if (
        notification[userId]?.[75] &&
        notification[userId]?.[50] &&
        notification[userId]?.[25]
      ) {
        notification[userId] = { 75: false, 50: false, 25: false };
        fs.writeFileSync(
          "./notification.json",
          JSON.stringify(notification, null, 2)
        );
      }
    } else {
      if (diffPercentage.toFixed(0) == "75") {
        const alreadyNotified = notification[userId]?.[75];
        if (alreadyNotified) return;
        notification[userId] = {
          ...notification[userId],
          75: true,
        };
        fs.writeFileSync(
          "./notification.json",
          JSON.stringify(notification, null, 2)
        );
        sendNotification(
          `Reminder ${config[userId].currentPrayerTimes.name}`,
          `Waktu Shalat ${config[userId].currentPrayerTimes.name} akan tiba`,
          latestPrayerName,
          userId,
          75
        );
      } else {
        if (notification[userId]?.[75]) {
          notification[userId] = {
            ...notification[userId],
            75: false,
          };
          fs.writeFileSync(
            "./notification.json",
            JSON.stringify(notification, null, 2)
          );
        }
      }
    }
  }

  setInterval(async () => {
    await getAllUsers();
    let dataUsers = JSON.parse(fs.readFileSync("./users.json"));

    if (dataUsers.length === 0) return;

    const endIndex = Math.min(
      currentIndexPrayer + batchSizePrayer,
      dataUsers.length
    );
    for (let i = currentIndexPrayer; i < endIndex; i++) {
      const user = dataUsers[i];

      if (!notification[user[1].phoneNumber]) {
        notification[user[1].phoneNumber] = {
          75: false,
          50: false,
          25: false,
        };
        fs.writeFileSync(
          "./notification.json",
          JSON.stringify(notification, null, 2)
        );
      }

      if (user[1].userLat && user[1].userLng) {
        if (
          hasLocationChanged(
            user[1].phoneNumber,
            user[1].userLat,
            user[1].userLng
          )
        ) {
          await getPrayerTimes(
            user[1].phoneNumber,
            user[1].userLat,
            user[1].userLng
          );
        }
      }
    }

    currentIndexPrayer += batchSizePrayer;
    if (currentIndexPrayer >= dataUsers.length) currentIndexPrayer = 0;
  }, 60000);

  setInterval(async () => {
    let dataUsers = JSON.parse(fs.readFileSync("./users.json"));
    if (dataUsers.length === 0) return;

    const endIndex = Math.min(currentIndex + batchSize, dataUsers.length);
    for (let i = currentIndex; i < endIndex; i++) {
      const user = dataUsers[i];
      const userInfo = user[1];

      if (!notification[user[1].phoneNumber]) {
        notification[user[1].phoneNumber] = { 75: false, 50: false, 25: false };
        await writeNotification(notification);
      }

      if (prayerTimes[userInfo.phoneNumber]) {
        await updatePrayerTime(
          userInfo.phoneNumber,
          prayerTimes[userInfo.phoneNumber]
        );
        await checkNotification(userInfo.phoneNumber);
      }
    }

    currentIndex += batchSize;
    if (currentIndex >= dataUsers.length) currentIndex = 0;
  }, 1000 * 15);
}

startApp();
