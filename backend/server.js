import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import bcrypt from "bcrypt";
import validator from "validator";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { getPool, sql } from "./db.mssql.js"; // <-- MSSQL bağlantısı
import Iyzipay from "iyzipay";
import dotenv from "dotenv";
dotenv.config();
import soap from "soap";
import multer from "multer";
import nodemailer from "nodemailer";

const iyzipay = new Iyzipay({
  apiKey: "sandbox-eI51Rj7CHjWCLrtxy58lwmYRkMH492sq",
  secretKey: "sandbox-KGgGkoD9KZWPnK4ZIyZqQ5V33oYBFmuP",
  uri: "https://sandbox-api.iyzipay.com",
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 3000;

// CV upload klasörü ve multer ayarı- CV Yükleme Kısmı
const uploadDir = path.join(__dirname, "..", "uploads", "cv");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    cb(null, unique + "-" + safeName);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ÜRÜN GÖRSELLERİ İÇİN AYRI KLASÖR VE MULTER
const productUploadDir = path.join(__dirname, "..", "uploads", "products");

if (!fs.existsSync(productUploadDir)) {
  fs.mkdirSync(productUploadDir, { recursive: true });
}

const productStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, productUploadDir); // ürün görselleri /uploads/products altına
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    const base = path
      .basename(file.originalname, ext)
      .replace(/\s+/g, "-")
      .toLowerCase();
    const unique = Date.now();
    cb(null, `${base}-${unique}${ext}`);
  },
});

const productUpload = multer({
  storage: productStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

/* ---------------- Middleware ---------------- */
/* ---------------- Middleware ---------------- */
/* ---------------- Middleware ---------------- */
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(process.env.SESSION_SECRET));

// ---------------- Mail (nodemailer) ayarları ----------------
const mailTransporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,       // örn: "smtp.gmail.com"
  port: Number(process.env.SMTP_PORT || 587),
  secure: process.env.SMTP_SECURE === "true", // 465 ise true, 587 ise false
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Basit bir kontrol (uygulama açılırken loglasın)
mailTransporter.verify((err, success) => {
  if (err) {
    console.error("Mail server bağlantı hatası:", err);
  } else {
    console.log("Mail server hazır:", success);
  }
});

/* ---------------- Statik (frontend) ---------------- */
const PUBLIC_DIR = path.join(__dirname, "..", "public");
if (!fs.existsSync(PUBLIC_DIR)) {
  console.warn("UYARI: public/ klasörü bulunamadı. Statik dosyalar servis edilemiyor.");
}
app.use(express.static(PUBLIC_DIR, { extensions: ["html"] }));
// upload edilen dosyaları (cv + ürün görselleri) statik servis et
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));



/* ---------------- Session yardımcıları ---------------- */
function setSession(res, payload) {
  const value = JSON.stringify({ ...payload, t: Date.now() });
  res.cookie("sid", value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    signed: true,
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 gün
  });
}
function getSession(req) {
  const raw = req.signedCookies?.sid;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
function clearSession(res) {
  res.clearCookie("sid");
}
const isEmail = (e) => validator.isEmail(String(e || "").trim());

/* ---------------- Yardımcı: oturumdan userId alma ---------------- */
function requireUserId(req, res) {
  const sess = getSession(req);
  if (!sess?.userId) {
    res.status(401).json({ error: "Yetkisiz" });
    return null;
  }
  return sess.userId;
}

// ----- ADMIN HELPERLARI -----

async function getAdminUser(req) {
  const sess = getSession(req);
  if (!sess?.userId) return null;

  const pool = await getPool();
  const r = await pool
    .request()
    .input("id", sql.Int, sess.userId)
    .query(`
      SELECT Id, FullName, Email, IsAdmin
      FROM dbo.Users
      WHERE Id = @id
    `);

  if (!r.recordset.length) return null;
  const user = r.recordset[0];
  if (!user.IsAdmin) return null;
  return user;
}

// Express middleware: sadece admin erişsin
function requireAdmin(req, res, next) {
  getAdminUser(req)
    .then((admin) => {
      if (!admin) {
        return res.status(401).json({ ok: false, error: "Admin girişi gerekli." });
      }
      req.admin = admin; // istersen kullan
      next();
    })
    .catch((err) => {
      console.error("requireAdmin error:", err);
      res.status(500).json({ ok: false, error: "Sunucu hatası." });
    });
}


/* ---------------- API: Register ---------------- */
app.post("/auth/register", async (req, res) => {
  const full_name = String(req.body.full_name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.reg_password || "");
  const confirm = String(req.body.reg_password_confirm || "");
  const fieldErrors = {};

  if (!full_name) fieldErrors.full_name = "Ad Soyad zorunludur.";
  if (!email) fieldErrors.email = "E-posta zorunludur.";
  else if (!isEmail(email)) fieldErrors.email = "Geçerli bir e-posta girin.";
  if (!password) fieldErrors.reg_password = "Şifre zorunludur.";
  else if (password.length < 8) fieldErrors.reg_password = "Şifre en az 8 karakter olmalı.";
  if (!confirm) fieldErrors.reg_password_confirm = "Şifre tekrar zorunludur.";
  else if (password !== confirm) fieldErrors.reg_password_confirm = "Şifreler uyuşmuyor.";

  if (Object.keys(fieldErrors).length) return res.status(400).json({ fieldErrors });

  try {
    const pool = await getPool(); // <<< ÖNEMLİ: getPool kullan

    // E-posta var mı?
    const existing = await pool
      .request()
      .input("email", sql.NVarChar(320), email)
      .query("SELECT Id FROM dbo.Users WHERE Email = @email");

    if (existing.recordset.length) {
      return res.status(409).json({ fieldErrors: { email: "Bu e-posta ile kayıt var." } });
    }

    const hash = await bcrypt.hash(password, 12);

    const insert = await pool
      .request()
      .input("fullName", sql.NVarChar(200), full_name)
      .input("email", sql.NVarChar(320), email)
      .input("hash", sql.NVarChar(255), hash)
      .query(`
        INSERT INTO dbo.Users (FullName, Email, PasswordHash)
        OUTPUT INSERTED.Id
        VALUES (@fullName, @email, @hash)
      `);

    const newId = insert.recordset[0].Id;
    setSession(res, { userId: newId });

    const wantsHTML = (req.headers.accept || "").includes("text/html");
    if (wantsHTML) return res.redirect(303, "/account.html");
    return res.json({ redirect: "/account.html" });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: "Sunucu hatası" });
  }
});

/* ---------------- API: Login ---------------- */
app.post("/auth/login", async (req, res) => {
  const identifier = String(req.body.identifier || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  const fieldErrors = {};
  if (!identifier) fieldErrors.identifier = "Kullanıcı adı veya e-posta zorunludur.";
  if (!password) fieldErrors.password = "Şifre zorunludur.";
  if (Object.keys(fieldErrors).length) return res.status(400).json({ fieldErrors });

  try {
    const pool = await getPool();

    // Şemada 'Password' kolonu var mı?
    const col = await pool.request().query(`
      SELECT 1
      FROM sys.columns
      WHERE object_id = OBJECT_ID('dbo.Users') AND name = 'Password'
    `);
    const hasPasswordCol = col.recordset.length > 0;

    // Şemaya göre SELECT'i kur
    const selectSql = hasPasswordCol
      ? `
        SELECT TOP 1 Id, Email, 
               CASE WHEN PasswordHash IS NOT NULL THEN PasswordHash ELSE Password END AS PasswordHash
        FROM dbo.Users
        WHERE LOWER(Email) = @email
        `
      : `
        SELECT TOP 1 Id, Email, PasswordHash
        FROM dbo.Users
        WHERE LOWER(Email) = @email
        `;

    const result = await pool
      .request()
      .input("email", sql.NVarChar(320), identifier)
      .query(selectSql);

    if (!result.recordset.length) {
      return res.status(404).json({ fieldErrors: { identifier: "Kayıt bulunamadı." } });
    }

    const user = result.recordset[0];

    if (!user.PasswordHash) {
      return res
        .status(500)
        .json({ message: "Hesapta şifre verisi eksik. Lütfen hesabı yeniden oluşturun." });
    }

    const ok = await bcrypt.compare(password, user.PasswordHash);
    if (!ok) return res.status(401).json({ fieldErrors: { password: "Şifre hatalı." } });

    setSession(res, { userId: user.Id });

    const wantsHTML = (req.headers.accept || "").includes("text/html");
    if (wantsHTML) return res.redirect(303, "/account.html");
    return res.json({ redirect: "/account.html" });
  } catch (e) {
    console.error("LOGIN ERROR:", e?.message || e, e?.stack);
    return res.status(500).json({ message: "Sunucu hatası" });
  }
});

/* ---------------- API: İş Başvurusu ---------------- */
app.post(
  "/api/job-application",
  upload.single("cvFile"), // formdaki input name="cvFile"
  async (req, res) => {
    const body = req.body || {};
    const fieldErrors = {};

    const firstName = String(body.firstName || "").trim();
    const lastName = String(body.lastName || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const birthDateStr = String(body.birthDate || "").trim();
    const phone = String(body.phone || "").trim();
    const address = String(body.address || "").trim();
    const educationLevel = String(body.educationLevel || "").trim() || null;
    const lastSchool = String(body.lastSchool || "").trim();
    const militaryStatus = String(body.militaryStatus || "").trim() || null;
    const drivingLicense = String(body.drivingLicense || "").trim() || null;
    const languages = String(body.languages || "").trim();
    const desiredDepartment = String(body.desiredDepartment || "").trim();
    const desiredDepartmentOther =
      String(body.desiredDepartmentOther || "").trim() || null;
    const criminalRecord =
      String(body.criminalRecord || "yok").trim().toLowerCase() || "yok";
    const referencesText =
      String(body.references || "").trim() || null;
    const otherNotes =
      String(body.otherNotes || "").trim() || null;
    const approval = body.approval; // checkbox: "on" gelmesi beklenir

    // --- Basit validasyonlar ---
    if (!firstName) fieldErrors.firstName = "Ad zorunludur.";
    if (!lastName) fieldErrors.lastName = "Soyad zorunludur.";

    if (!email) fieldErrors.email = "E-posta zorunludur.";
    else if (!isEmail(email)) fieldErrors.email = "Geçerli bir e-posta girin.";

    if (!birthDateStr) fieldErrors.birthDate = "Doğum tarihi zorunludur.";
    let birthDateValue = null;
    if (birthDateStr) {
      const d = new Date(birthDateStr);
      if (isNaN(d.getTime())) {
        fieldErrors.birthDate = "Geçerli bir tarih girin.";
      } else {
        birthDateValue = d;
      }
    }

    if (!phone) fieldErrors.phone = "Telefon zorunludur.";
    if (!address) fieldErrors.address = "Adres zorunludur.";

    if (!lastSchool) fieldErrors.lastSchool = "Son mezun olduğunuz okul ve bölüm zorunludur.";

    if (!languages) fieldErrors.languages = "Yabancı dil bilgisi zorunludur.";
    if (!desiredDepartment)
      fieldErrors.desiredDepartment = "Çalışmak istediğiniz bölüm zorunludur.";

    if (!approval) {
      fieldErrors.approval =
        "Başvuruyu tamamlamak için beyan ettiğiniz bilgilerin doğruluğunu onaylamalısınız.";
    }

    // Dosya bilgisi (isteğe bağlı)
    const cvFile = req.file || null;
    const cvFileName = cvFile ? cvFile.originalname : null;
    const cvFilePath = cvFile ? cvFile.path : null;

    if (Object.keys(fieldErrors).length > 0) {
      // Frontend'de yakalayacağız (JS ile)
      return res.status(400).json({
        ok: false,
        message: "Lütfen formu kontrol edin.",
        fieldErrors,
      });
    }

    try {
      const pool = await getPool();

      await pool
        .request()
        .input("FirstName", sql.NVarChar(100), firstName)
        .input("LastName", sql.NVarChar(100), lastName)
        .input("Email", sql.NVarChar(320), email)
        .input("BirthDate", sql.Date, birthDateValue)
        .input("Phone", sql.NVarChar(50), phone)
        .input("Address", sql.NVarChar(500), address)
        .input("EducationLevel", sql.NVarChar(50), educationLevel)
        .input("LastSchool", sql.NVarChar(300), lastSchool)
        .input("MilitaryStatus", sql.NVarChar(50), militaryStatus)
        .input("DrivingLicense", sql.NVarChar(100), drivingLicense)
        .input("Languages", sql.NVarChar(400), languages)
        .input("DesiredDepartment", sql.NVarChar(100), desiredDepartment)
        .input(
          "DesiredDepartmentOther",
          sql.NVarChar(200),
          desiredDepartmentOther
        )
        .input("CriminalRecord", sql.NVarChar(10), criminalRecord)
        .input("References", sql.NVarChar(sql.MAX), referencesText)
        .input("OtherNotes", sql.NVarChar(sql.MAX), otherNotes)
        .input("CvFileName", sql.NVarChar(255), cvFileName)
        .input("CvFilePath", sql.NVarChar(400), cvFilePath)
        .input("IpAddress", sql.NVarChar(45), req.ip || null)
        .query(`
          INSERT INTO dbo.JobApplications (
            FirstName,
            LastName,
            Email,
            BirthDate,
            Phone,
            [Address],
            EducationLevel,
            LastSchool,
            MilitaryStatus,
            DrivingLicense,
            Languages,
            DesiredDepartment,
            DesiredDepartmentOther,
            CriminalRecord,
            [References],
            OtherNotes,
            CvFileName,
            CvFilePath,
            IpAddress
          )
          VALUES (
            @FirstName,
            @LastName,
            @Email,
            @BirthDate,
            @Phone,
            @Address,
            @EducationLevel,
            @LastSchool,
            @MilitaryStatus,
            @DrivingLicense,
            @Languages,
            @DesiredDepartment,
            @DesiredDepartmentOther,
            @CriminalRecord,
            @References,
            @OtherNotes,
            @CvFileName,
            @CvFilePath,
            @IpAddress
          );
        `);
      try {
        const notifyTo = process.env.JOB_APP_NOTIFY_TO || process.env.SMTP_USER;

        const subject = `Yeni İş Başvurusu (CV): ${firstName} ${lastName}`;

        const textBody = `
Yeni bir iş başvurusu alındı.

Ad Soyad: ${firstName} ${lastName}
E-posta: ${email}
Telefon: ${phone}
Doğum Tarihi: ${birthDateStr}
Adres: ${address}

Öğrenim Durumu: ${educationLevel || "-"}
Son Mezun Olunan Okul / Bölüm: ${lastSchool}

Askerlik Durumu: ${militaryStatus || "-"}
Ehliyet: ${drivingLicense || "-"}

Yabancı Diller: ${languages}
Çalışmak İstediği Bölüm: ${desiredDepartment}
Diğer Bölüm: ${desiredDepartmentOther || "-"}

Adli Sicil Kaydı: ${criminalRecord}

Referanslar:
${referencesText || "-"}

Diğer Notlar:
${otherNotes || "-"}

Bu mail web sitesi iş başvuru formundan otomatik olarak gönderilmiştir.
`;

        const htmlBody = `
    <h2>Yeni İş Başvurusu (CV)</h2>
    <p><strong>Ad Soyad:</strong> ${firstName} ${lastName}</p>
    <p><strong>E-posta:</strong> ${email}</p>
    <p><strong>Telefon:</strong> ${phone}</p>
    <p><strong>Doğum Tarihi:</strong> ${birthDateStr}</p>
    <p><strong>Adres:</strong> ${address}</p>
    <hr>
    <p><strong>Öğrenim Durumu:</strong> ${educationLevel || "-"}</p>
    <p><strong>Son Mezun Olunan Okul / Bölüm:</strong> ${lastSchool}</p>
    <p><strong>Askerlik Durumu:</strong> ${militaryStatus || "-"}</p>
    <p><strong>Ehliyet:</strong> ${drivingLicense || "-"}</p>
    <p><strong>Yabancı Diller:</strong> ${languages}</p>
    <p><strong>Çalışmak İstediği Bölüm:</strong> ${desiredDepartment}</p>
    <p><strong>Diğer Bölüm:</strong> ${desiredDepartmentOther || "-"}</p>
    <p><strong>Adli Sicil Kaydı:</strong> ${criminalRecord}</p>
    <hr>
    <p><strong>Referanslar:</strong><br>${(referencesText || "-")
            .replace(/\n/g, "<br>")}</p>
    <p><strong>Diğer Notlar:</strong><br>${(otherNotes || "-")
            .replace(/\n/g, "<br>")}</p>
    <hr>
    <p style="font-size:12px;color:#666;">Bu mail web sitesi iş başvuru formundan otomatik olarak gönderilmiştir.</p>
  `;

        const mailOptions = {
          from: `"Web İş Başvurusu" <${process.env.SMTP_USER}>`, // Gönderici: senin SMTP hesabın
          to: notifyTo,                                         // Alıcı: r.turkmen@dronetech.com.tr
          subject,
          text: textBody,
          html: htmlBody,
          attachments: [],
        };

        // CV yüklendiyse mail'e ekle
        if (cvFilePath && cvFileName) {
          mailOptions.attachments.push({
            filename: cvFileName,
            path: cvFilePath,
          });
        }

        mailTransporter.sendMail(mailOptions).catch((err) => {
          console.error("Başvuru maili gönderilemedi:", err);
        });
      } catch (mailErr) {
        console.error("Mail hazırlarken hata:", mailErr);
      }

      // Şimdilik JSON döndürüyoruz; bir sonraki adımda JS ile bunu yakalayacağız.
      return res.status(201).json({
        ok: true,
        message: "Başvurunuz başarıyla kaydedildi.",
      });
    } catch (err) {
      console.error("POST /api/job-application error:", err);
      return res
        .status(500)
        .json({ ok: false, message: "Sunucu hatası, lütfen tekrar deneyin." });
    }
  }
);

/* ---------------- API: İletişim Formu ---------------- */
app.post("/api/contact", async (req, res) => {
  const body = req.body || {};
  const fieldErrors = {};

  const firstName = String(body.firstName || "").trim();
  const lastName = String(body.lastName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const subject = String(body.subject || "").trim();
  const messageText = String(body.message || "").trim();

  // --- Basit validasyonlar ---
  if (!firstName) fieldErrors.firstName = "Ad zorunludur.";
  if (!lastName) fieldErrors.lastName = "Soyad zorunludur.";

  if (!email) fieldErrors.email = "E-posta zorunludur.";
  else if (!isEmail(email)) fieldErrors.email = "Geçerli bir e-posta adresi girin.";

  if (!subject) fieldErrors.subject = "Konu zorunludur.";
  if (!messageText) fieldErrors.message = "Mesaj zorunludur.";

  if (Object.keys(fieldErrors).length > 0) {
    return res.status(400).json({
      ok: false,
      message: "Lütfen formu kontrol edin.",
      fieldErrors,
    });
  }

  try {
    const pool = await getPool();

    // 1) Veritabanına kaydet
    await pool
      .request()
      .input("FirstName", sql.NVarChar(100), firstName)
      .input("LastName", sql.NVarChar(100), lastName)
      .input("Email", sql.NVarChar(320), email)
      .input("Subject", sql.NVarChar(200), subject)
      .input("Message", sql.NVarChar(sql.MAX), messageText)
      .input("IpAddress", sql.NVarChar(45), req.ip || null)
      .query(`
        INSERT INTO dbo.ContactMessages (
          FirstName,
          LastName,
          Email,
          Subject,
          Message,
          IpAddress
        )
        VALUES (
          @FirstName,
          @LastName,
          @Email,
          @Subject,
          @Message,
          @IpAddress
        );
      `);

    // 2) Sana mail gönder
    try {
      const notifyTo =
        process.env.CONTACT_NOTIFY_TO ||
        process.env.JOB_APP_NOTIFY_TO ||
        process.env.SMTP_USER;

      const mailSubject = `İletişim Formu: ${subject} - ${firstName} ${lastName}`;

      const textBody = `
Web sitenizden yeni bir iletişim mesajı alındı.

Ad Soyad : ${firstName} ${lastName}
E-posta  : ${email}
Konu     : ${subject}

Mesaj:
${messageText}

IP Adresi: ${req.ip || "-"}

Bu mail web sitesi iletişim formundan otomatik olarak gönderilmiştir.
`;

      const htmlBody = `
        <h2>Yeni İletişim Mesajı</h2>
        <p><strong>Ad Soyad:</strong> ${firstName} ${lastName}</p>
        <p><strong>E-posta:</strong> ${email}</p>
        <p><strong>Konu:</strong> ${subject}</p>
        <hr>
        <p><strong>Mesaj:</strong><br>${messageText.replace(/\n/g, "<br>")}</p>
        <hr>
        <p><small>IP Adresi: ${req.ip || "-"}</small></p>
        <p style="font-size:12px;color:#666;">Bu mail web sitesi iletişim formundan otomatik olarak gönderilmiştir.</p>
      `;

      await mailTransporter.sendMail({
        from: `"Web İletişim" <${process.env.SMTP_USER}>`,
        to: notifyTo,
        replyTo: email, // cevapla deyince gönderene gider (istersen kaldırabilirsin)
        subject: mailSubject,
        text: textBody,
        html: htmlBody,
      });
    } catch (mailErr) {
      console.error("İletişim maili gönderilemedi:", mailErr);
      // Kullanıcıya hata dönmüyoruz; sadece log'da kalsın istiyorsan böyle bırak
    }

    return res.status(201).json({
      ok: true,
      message: "Mesajınız başarıyla gönderildi. En kısa sürede sizinle iletişime geçilecektir.",
    });
  } catch (err) {
    console.error("POST /api/contact error:", err);
    return res
      .status(500)
      .json({ ok: false, message: "Sunucu hatası, lütfen daha sonra tekrar deneyin." });
  }
});


/* ---------------- API: Forgot Password (mail + yeni şifre) ---------------- */
app.post("/auth/forgot-password", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const newPassword = String(req.body.new_password || "");
  const confirm = String(req.body.new_password_confirm || "");

  const fieldErrors = {};

  if (!email) fieldErrors.email = "E-posta zorunludur.";
  else if (!isEmail(email)) fieldErrors.email = "Geçerli bir e-posta girin.";
  if (!newPassword) fieldErrors.new_password = "Yeni şifre zorunludur.";
  else if (newPassword.length < 8)
    fieldErrors.new_password = "Şifre en az 8 karakter olmalı.";
  if (!confirm) fieldErrors.new_password_confirm = "Şifre tekrar zorunludur.";
  else if (newPassword !== confirm)
    fieldErrors.new_password_confirm = "Şifreler uyuşmuyor.";

  if (Object.keys(fieldErrors).length) {
    return res.status(400).json({ fieldErrors });
  }

  try {
    const pool = await getPool();

    // Kullanıcı var mı?
    const userRes = await pool
      .request()
      .input("email", sql.NVarChar(320), email)
      .query(`
        SELECT TOP 1 Id
        FROM dbo.Users
        WHERE LOWER(Email) = @email
      `);

    if (!userRes.recordset.length) {
      return res
        .status(404)
        .json({ fieldErrors: { email: "Bu e-posta ile kayıt bulunamadı." } });
    }

    const userId = userRes.recordset[0].Id;
    const hash = await bcrypt.hash(newPassword, 12);

    await pool
      .request()
      .input("id", sql.Int, userId)
      .input("hash", sql.NVarChar(255), hash)
      .query(`
        UPDATE dbo.Users
        SET PasswordHash = @hash
        WHERE Id = @id
      `);

    return res.json({
      ok: true,
      message: "Şifreniz güncellendi. Giriş yapabilirsiniz.",
      redirect: "/login.html",
    });
  } catch (e) {
    console.error("FORGOT PASSWORD ERROR:", e);
    return res.status(500).json({ error: "Sunucu hatası" });
  }
});


/* ---------------- API: Logout ---------------- */
app.post("/auth/logout", (req, res) => {
  clearSession(res);
  res.json({ ok: true, redirect: "/login.html" });
});

/* ---------------- Korumalı örnek endpoint: /api/me ---------------- */
app.get("/api/me", async (req, res) => {
  const sess = getSession(req);
  if (!sess?.userId) return res.status(401).json({ error: "Yetkisiz" });

  try {
    const pool = await getPool();
    const r = await pool
      .request()
      .input("id", sql.Int, sess.userId)
      .query(`
        SELECT
          Id        AS id,
          FullName  AS full_name,
          Email     AS email,
          CreatedAt AT TIME ZONE 'UTC' AT TIME ZONE 'Turkey Standard Time' AS created_at
        FROM dbo.Users
        WHERE Id = @id
      `);

    if (!r.recordset.length) return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    res.json({ user: r.recordset[0] });
  } catch (e) {
    console.error("DB /api/me hatası:", e);
    res.status(500).json({ error: "DB hatası" });
  }
});

// Admin paneli için: mevcut admin bilgisi
app.get("/api/admin/me", async (req, res) => {
  try {
    const admin = await getAdminUser(req);
    if (!admin) return res.status(401).json({ ok: false });

    return res.json({
      ok: true,
      user: {
        id: admin.Id,
        fullName: admin.FullName,
        email: admin.Email,
      },
    });
  } catch (e) {
    console.error("GET /api/admin/me error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Sunucu hatası" });
  }
});

/* ---------------- Adres endpoint'leri ---------------- */

// GET /api/addresses  → kullanıcının billing & shipping adreslerini getir
app.get("/api/addresses", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .input("UserId", sql.Int, userId)
      .query(`
        SELECT TOP 1 *
        FROM dbo.UserAddresses
        WHERE UserId = @UserId AND Type = 'shipping'
        ORDER BY Id DESC
      `);

    res.json({ address: result.recordset[0] || null });
  } catch (err) {
    console.error("GET /api/addresses error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/payments/iyzico/init  → iyzico ödeme başlat
app.post("/api/payments/iyzico/init", async (req, res) => {
  try {
    console.log("Iyzico init body:", req.body);

    // 🔥 Artık frontend'den bunlar geliyor:
    // subtotal     → sadece ürünlerin toplamı
    // shippingFee  → kargo ücreti
    // totalPrice   → subtotal + shippingFee (karttan çekilecek toplam)
    const { subtotal, totalPrice, shippingFee, cart, address } = req.body || {};

    const sub = Number(subtotal || 0);
    const ship = Number(shippingFee || 0);
    const total = Number(totalPrice || 0);

    if (!sub || !cart || !cart.length) {
      return res
        .status(400)
        .json({ ok: false, error: "Sepet veya tutar yok." });
    }

    // 🔹 Oturumdan userId almaya çalış
    const sess = getSession(req);
    const userId = sess?.userId || null;

    // 🔹 1) PendingOrders'a geçici siparişi kaydet
    const pool = await getPool();
    const pendingResult = await pool
      .request()
      .input("UserId", sql.Int, userId)
      // Burada TotalPrice'ı İSTEDİĞİN gibi yorumlayabilirsin.
      // Şu an total (ürün + kargo) olarak kaydediyoruz:
      .input("TotalPrice", sql.Decimal(18, 2), total)
      .input("CartJson", sql.NVarChar, JSON.stringify(cart || []))
      .input("AddressJson", sql.NVarChar, JSON.stringify(address || {}))
      .input("ShippingFee", sql.Decimal(18, 2), ship)
      .query(`
        INSERT INTO dbo.PendingOrders
          (UserId, TotalPrice, CartJson, AddressJson, ShippingFee, CreatedAt)
        OUTPUT INSERTED.Id
        VALUES
          (@UserId, @TotalPrice, @CartJson, @AddressJson, @ShippingFee, SYSUTCDATETIME())
      `);

    const pendingId = pendingResult.recordset[0].Id;
    console.log("💾 PendingOrders insert Id:", pendingId);

    // 🔹 Bunları iyzico'ya conversationId ve basketId olarak göndereceğiz
    const conversationId = String(pendingId);
    const basketId = "BASKET_" + pendingId;

    // 🔹 2) İyzico'nun istediği buyer & adres & sepet
    const buyer = {
      id: String(userId || "GUEST"),
      name: address?.firstName || "Test",
      surname: address?.lastName || "User",
      gsmNumber: address?.phone || "+905350000000",
      email: address?.email || "test@example.com",
      identityNumber: "74300864791",
      registrationAddress: address?.address || "İstanbul",
      city: address?.city || "İstanbul",
      country: "Turkey",
      zipCode: address?.zipCode || "34000",
      ip: req.ip || "127.0.0.1",
    };

    const shippingAddress = {
      contactName: `${address?.firstName || "Ad"} ${address?.lastName || "Soyad"
        }`,
      city: address?.city || "İstanbul",
      country: "Turkey",
      address: address?.address || "Adres",
      zipCode: address?.zipCode || "34000",
    };

    const billingAddress = shippingAddress;

    const basketItems = (cart || []).map((item, index) => {
      const qty = item.qty || 1;
      const price = Number(item.price || 0);
      return {
        id: String(item.id || index + 1),
        name: item.name || "Ürün",
        category1: item.cat || item.category || "Genel",
        itemType: Iyzipay.BASKET_ITEM_TYPE.PHYSICAL,
        price: (price * qty).toFixed(2), // 🔹 ÜRÜN TOPLAMI (subtotal'ın parçaları)
      };
    });

    // 🔹 3) İyzico checkout form initialize isteği
    // 💥 KRİTİK:
    //   price     = sadece ürün toplamı (subtotal)
    //   paidPrice = ürün + kargo (totalPrice)
    const request = {
      locale: Iyzipay.LOCALE.TR,
      conversationId, // "42" (PendingOrders.Id)
      price: sub.toFixed(2),
      paidPrice: total.toFixed(2),
      currency: Iyzipay.CURRENCY.TRY,
      basketId, // "BASKET_42"
      paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,
      callbackUrl: "http://localhost:3000/iyzico-callback",
      buyer,
      shippingAddress,
      billingAddress,
      basketItems,
    };

    iyzipay.checkoutFormInitialize.create(request, async (err, result) => {
      try {
        if (err) {
          console.error("iyzico init error:", err);
          return res
            .status(500)
            .json({ ok: false, error: "İyzico isteği başarısız." });
        }

        console.log("Iyzico init result:", result);

        if (result.status !== "success") {
          return res.status(500).json({
            ok: false,
            error: result.errorMessage || "İyzico hata",
          });
        }

        const token = result.token;
        console.log("💾 Init: pendingId =", pendingId, "token =", token);

        // 🔹 PendingOrders’a token’ı yaz
        const pool2 = await getPool();
        await pool2
          .request()
          .input("Id", sql.Int, pendingId)
          .input("Token", sql.NVarChar, token)
          .query(`
            UPDATE dbo.PendingOrders
            SET IyzicoToken = @Token
            WHERE Id = @Id
          `);

        // 🔹 Frontend’e ödeme sayfası linkini dön
        return res.json({
          ok: true,
          paymentPageUrl: result.paymentPageUrl,
          paymentId: result.paymentId,
        });
      } catch (innerErr) {
        console.error("iyzico init içinde hata:", innerErr);
        return res
          .status(500)
          .json({ ok: false, error: "Sunucu hatası (init)" });
      }
    });
  } catch (e) {
    console.error("iyzico init catch:", e);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});
// ---------------- GERÇEK Yurtiçi Kargo Entegrasyonu ----------------

// .env'den Yurtiçi ayarlarını oku
const YK_WS_URL =
  process.env.YK_WS_URL ||
  "http://testwebservices.yurticikargo.com:9090/KOPSWebServices/ShippingOrderDispatcherServices?wsdl";
const YK_WS_USERNAME = process.env.YK_WS_USERNAME || "YKTEST";
const YK_WS_PASSWORD = process.env.YK_WS_PASSWORD || "YK";
const YK_WS_LANGUAGE = process.env.YK_WS_LANGUAGE || "TR";
/**
 * Gerçek Yurtiçi Kargo createShipment entegrasyonu
 * orderId: DB'deki sipariş Id
 * buyer: { firstName, lastName, phone, email }
 * shippingAddress: { address, city, district, postalCode }
 * cartItems: sepet array'i
 *
 * return { success: boolean, trackingNumber?: string, cargoKey?: string, jobId?: number, error?: string }
 */
async function createYurticiKargoShipment(orderId, buyer, shippingAddress, cartItems) {
  try {
    // 1) cargoKey & invoiceKey üret (max 20 karakter, tekil)
    // Örnek: ORD0000003
    const baseKey = String(orderId).padStart(7, "0");
    const cargoKey = `DT${baseKey}`;   // müşteri kargo anahtarı
    const invoiceKey = cargoKey;        // fatura anahtarı da aynı olsun

    // 2) Alıcı bilgilerini hazırla
    const fullName = `${buyer.firstName || ""} ${buyer.lastName || ""}`.trim() || "MÜŞTERİ";
    const rawPhone = (buyer.phone || "").replace(/\D/g, ""); // rakam dışı karakterleri at
    let phone10 = rawPhone;
    if (rawPhone.length === 11 && rawPhone.startsWith("0")) {
      phone10 = rawPhone.slice(1);      // 0'ı at -> 10 haneli
    }

    const receiverCustName = fullName.substring(0, 200);
    const receiverAddress = (shippingAddress.address || "").substring(0, 200);

    const cityName = (shippingAddress.city || "").substring(0, 40);
    const townName = (shippingAddress.district || "").substring(0, 40);

    // 3) SOAP client oluştur
    const client = await soap.createClientAsync(YK_WS_URL);

    // 4) createShipment isteğinin gövdesi
    const request = {
      wsUserName: YK_WS_USERNAME,
      wsPassword: YK_WS_PASSWORD,
      userLanguage: YK_WS_LANGUAGE,
      ShippingOrderVO: [
        {
          cargoKey,               // zorunlu
          invoiceKey,             // zorunlu
          receiverCustName,       // zorunlu (min 5 char)
          receiverAddress,        // zorunlu (min 5 char)
          receiverPhone1: phone10 || "4543332020", // zorunlu, 10 hane
          cityName,               // opsiyonel ama biz gönderiyoruz
          townName,               // opsiyonel ama biz gönderiyoruz
          cargoCount: 1,          // şu an her siparişi tek koli sayıyoruz
          description: "DroneTech Online Sipariş",
          // İstersen burada specialField1 içine sipariş no vb. gönderebilirsin:
          // specialField1: `3$${orderId}#`  // 3: Sipariş No alanı (dokümanda var)
        },
      ],
    };

    console.log("YK createShipment request:", JSON.stringify(request, null, 2));

    // 5) createShipment çağrısı
    const [response] = await client.createShipmentAsync(request);

    console.log("YK createShipment raw response:", JSON.stringify(response, null, 2));

    // 6) Sonucu yorumla
    // Dönen yapı kabaca: { ShippingOrderResultVO: { outFlag, outResult, jobId, shippingOrderDetailVO: [...] } }
    const resultVO =
      response.ShippingOrderResultVO ||
      response.shippingOrderResultVO ||
      response;

    const outFlag = String(resultVO.outFlag ?? "");
    const outResult = resultVO.outResult || "";
    const jobId = resultVO.jobId;

    let detail = resultVO.shippingOrderDetailVO;
    if (Array.isArray(detail)) {
      detail = detail[0];
    }
    const errCode = detail?.errCode;
    const errMessage = detail?.errMessage;

    // outFlag = 0 ve errCode yok / 0 ise başarılı kabul edelim
    if (outFlag === "0" && (!errCode || Number(errCode) === 0)) {
      console.log("YK createShipment BAŞARILI:", { outResult, jobId, cargoKey });
      return {
        success: true,
        trackingNumber: cargoKey, // müşteriye göstereceğimiz "kargo anahtarı"
        cargoKey,
        jobId,
      };
    } else {
      const msg =
        errMessage ||
        outResult ||
        "Yurtiçi kargo createShipment hata döndürdü.";
      console.error("YK createShipment HATA:", {
        outFlag,
        errCode,
        errMessage,
        outResult,
      });
      return {
        success: false,
        error: msg,
      };
    }
  } catch (err) {
    console.error("Kargo servisi çağrılırken hata:", err);
    return {
      success: false,
      error: err.message || String(err),
    };
  }
}
// ---------------- GERÇEK Yurtiçi Kargo Entegrasyonu SON ----------------

//------------ YURTİÇİ KARGO - queryShipment (KARGOM NEREDE) ----------------
/**
 * Yurtiçi Kargo queryShipment
 * cargoKey: Bizim Orders.TrackingNumber alanına yazdığımız anahtar (ORD0000009 gibi)
 *
 * return: {
 *   success: boolean,
 *   statusText?: string,     // "Kargo Teslimatta", "Kargo Teslim Edildi" vb.
 *   raw?: any,               // İstersen tüm YK response'u da dönebiliriz
 *   error?: string
 * }
 */
async function queryYurticiKargoShipment(cargoKey) {
  try {
    if (!cargoKey) {
      return { success: false, error: "Geçersiz cargoKey" };
    }

    const client = await soap.createClientAsync(YK_WS_URL);

    // Dokümana göre: wsUserName, wsPassword, wsLanguage, keys[], keyType, addHistoricalData, onlyTracking 
    const request = {
      wsUserName: YK_WS_USERNAME,
      wsPassword: YK_WS_PASSWORD,
      wsLanguage: YK_WS_LANGUAGE, // "TR"
      keys: [cargoKey],           // kargo anahtarını array olarak gönderiyoruz
      keyType: 0,                 // 0: cargoKey ile sorgula
      addHistoricalData: true,    // hareket geçmişini de getir
      onlyTracking: false,        // sadece link değil, detaylı bilgi
    };

    console.log("YK queryShipment request:", JSON.stringify(request, null, 2));

    const [response] = await client.queryShipmentAsync(request);

    console.log("YK queryShipment raw response:", JSON.stringify(response, null, 2));

    const deliveryVO =
      response.ShippingDeliveryVO ||
      response.shippingDeliveryVO ||
      response;

    const outFlag = String(deliveryVO.outFlag ?? "");
    const outResult = deliveryVO.outResult || "";

    // shippingDeliveryDetailVO dizi olabilir
    let detail = deliveryVO.shippingDeliveryDetailVO;
    if (Array.isArray(detail)) {
      detail = detail[0];
    }

    const errCode = detail?.errCode;
    const errMessage = detail?.errMessage;

    // Hata varsa:
    if (outFlag !== "0" || (errCode && Number(errCode) !== 0)) {
      const msg = errMessage || outResult || "queryShipment hata döndürdü";
      console.error("YK queryShipment HATA:", {
        outFlag,
        errCode,
        errMessage,
        outResult,
      });
      return { success: false, error: msg, raw: response };
    }

    // Hareket / durum detayları ShippingDeliveryItemDetailVO içinden geliyor :contentReference[oaicite:1]{index=1}
    let item = detail.shippingDeliveryItemDetailVO;
    if (Array.isArray(item)) {
      item = item[0];
    }

    // Önemli alanları çekelim
    const statusText =
      item?.cargoEventExplanation ||
      item?.operationMessage ||
      "Kargo durumu alındı.";

    const lastEventDate = item?.lastEventDate || item?.deliveryDate || null;
    const lastEventTime = item?.lastEventTime || item?.deliveryTime || null;

    const summary = {
      cargoKey: item?.cargoKey || cargoKey,
      statusText,
      cargoEventId: item?.cargoEventId || null,
      cargoReasonExplanation: item?.cargoReasonExplanation || null,
      arrivalUnitName: item?.arrivalUnitName || null,
      lastEventDate,
      lastEventTime,
      deliveryDate: item?.deliveryDate || null,
      deliveryTime: item?.deliveryTime || null,
      receiverName: item?.receiverCustName || null,
    };

    return {
      success: true,
      statusText,
      summary,
      raw: response,
    };
  } catch (err) {
    console.error("YK queryShipment çağrılırken hata:", err);
    return {
      success: false,
      error: err.message || String(err),
    };
  }
}

// 💳 İyzico callback (ödeme sonucu burada tamamlanır)
app.post("/iyzico-callback", (req, res) => {
  const { token } = req.body || {};
  console.log("💳 Iyzico callback body:", req.body);

  if (!token) {
    console.error("❌ Callback'te token yok");
    return res.redirect(303, "/odeme-hata.html");
  }

  // 1) İyzico'dan gerçek sonuç sorgusu
  iyzipay.checkoutForm.retrieve(
    {
      locale: Iyzipay.LOCALE.TR,
      token,
    },
    async (err, result) => {
      if (err) {
        console.error("❌ iyzico retrieve error:", err);
        return res.redirect(303, "/odeme-hata.html");
      }

      console.log("✅ Iyzico retrieve result:", result);

      // Ödeme başarısızsa
      if (result.status !== "success" || result.paymentStatus !== "SUCCESS") {
        console.error("❌ Ödeme başarısız veya iptal:", {
          status: result.status,
          paymentStatus: result.paymentStatus,
          errorMessage: result.errorMessage,
        });
        return res.redirect(303, "/odeme-hata.html");
      }

      // Buraya geliyorsak ödeme kesin başarılı ✅

      // 2) DB transaction başlat
      let transaction;
      try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // 3) PendingOrders kaydını BUL – token ile
        const iyzToken = result.token || token;
        console.log("📦 Callback token ile pending ara:", iyzToken);

        const pendingReq = new sql.Request(transaction);
        const pendingRes = await pendingReq
          .input("Token", sql.NVarChar, iyzToken)
          .query(`
            SELECT TOP 1 *
            FROM dbo.PendingOrders
            WHERE IyzicoToken = @Token
          `);

        if (!pendingRes.recordset.length) {
          throw new Error("PendingOrders kaydı bulunamadı (token eşleşmedi)");
        }

        const pending = pendingRes.recordset[0];
        const pendingId = pending.Id;
        console.log("📦 Pending bulundu, Id =", pendingId);

        const cart = JSON.parse(pending.CartJson || "[]");
        //const shippingFee = Number(pending.ShippingFee || 0);
        const address = JSON.parse(pending.AddressJson || "{}");

        // 4) Orders tablosuna ana siparişi yaz
        const orderInsertReq = new sql.Request(transaction);
        const orderInsertRes = await orderInsertReq
          .input("UserId", sql.Int, pending.UserId)
          // PendingOrders.TotalPrice = ürün + kargo (frontend totalPrice)
          .input("TotalPrice", sql.Decimal(18, 2), Number(pending.TotalPrice))
          // paidPrice: iyzico'nun gerçekten tahsil ettiği tutar
          .input("PaidPrice", sql.Decimal(18, 2), Number(result.paidPrice))
          .input("PaymentId", sql.NVarChar(50), String(result.paymentId))
          .input("PaymentStatus", sql.NVarChar(20), String(result.paymentStatus))
          .input(
            "ConversationId",
            sql.NVarChar(100),
            String(result.conversationId || "")
          )
          .input("BasketId", sql.NVarChar(100), String(result.basketId || ""))
          .input(
            "IyzicoToken",
            sql.NVarChar(200),
            String(result.token || token)
          )
          .input(
            "Currency",
            sql.NVarChar(10),
            String(result.currency || "TRY")
          )
          .query(`
            INSERT INTO dbo.Orders
              (UserId, TotalPrice, PaidPrice, PaymentId, PaymentStatus,
               ConversationId, BasketId, IyzicoToken, Currency, CreatedAt)
            OUTPUT INSERTED.Id
            VALUES
              (@UserId, @TotalPrice, @PaidPrice, @PaymentId, @PaymentStatus,
               @ConversationId, @BasketId, @IyzicoToken, @Currency, SYSUTCDATETIME())
          `);

        const orderId = orderInsertRes.recordset[0].Id;

        // 5) OrderItems tablosuna sepet satırlarını yaz
        for (const item of cart) {
          const qty = item.qty || 1;
          const price = Number(item.price || 0);

          const itemsReq = new sql.Request(transaction);
          await itemsReq
            .input("OrderId", sql.Int, orderId)
            .input("ProductId", sql.NVarChar(50), item.id || null)
            .input("ProductName", sql.NVarChar(200), item.name || "Ürün")
            .input("Quantity", sql.Int, qty)
            .input("UnitPrice", sql.Decimal(18, 2), price)
            .input("TotalPrice", sql.Decimal(18, 2), price * qty)
            .query(`
              INSERT INTO dbo.OrderItems
                (OrderId, ProductId, ProductName, Quantity, UnitPrice, TotalPrice)
              VALUES
                (@OrderId, @ProductId, @ProductName, @Quantity, @UnitPrice, @TotalPrice)
            `);
        }

        // 6) Yurtiçi Kargo gönderisi oluştur
        const buyer = {
          firstName: address.firstName || "Müşteri",
          lastName: address.lastName || "",
          phone: address.phone || "",
          email: address.email || "",
        };

        const shippingAddress = {
          address: address.address || "",
          city: address.city || "",
          district: address.district || "",
          postalCode: address.zipCode || "",
        };

        const shipmentResult = await createYurticiKargoShipment(
          orderId,
          buyer,
          shippingAddress,
          cart
        );

        if (!shipmentResult?.success) {
          throw new Error(
            "Yurtiçi Kargo gönderisi oluşturulamadı: " +
            (shipmentResult?.error || "")
          );
        }

        const trackingNumber = shipmentResult.trackingNumber;

        // 6.b) Takip numarasını Orders tablosuna yaz
        const trackReq = new sql.Request(transaction);
        await trackReq
          .input("OrderId", sql.Int, orderId)
          .input("TrackingNumber", sql.NVarChar(50), trackingNumber || null)
          .query(`
            UPDATE dbo.Orders
            SET TrackingNumber = @TrackingNumber
            WHERE Id = @OrderId
          `);

        // PendingOrders kaydını sil
        const deleteReq = new sql.Request(transaction);
        await deleteReq
          .input("Id", sql.Int, pendingId)
          .query(`DELETE FROM dbo.PendingOrders WHERE Id = @Id`);

        // 7) Transaction'ı onayla (COMMIT)
        await transaction.commit();

        // Toplam tutarı (kargo dahil) PendingOrders.TotalPrice’tan al
        const grandTotal = Number(
          pending.TotalPrice || result.paidPrice || 0
        );

        // Müşteriyi başarı sayfasına, orderId & tracking & total ile yönlendir
        const qs = new URLSearchParams({
          orderId: String(orderId),
          tracking: trackingNumber || "",
          total: grandTotal.toFixed(2), // "102.00" gibi
        }).toString();

        return res.redirect(303, `/odeme-basarili.html?${qs}`);
      } catch (dbErr) {
        console.error("❌ Ödeme sonrası DB/Kargo hatası:", dbErr);
        if (transaction) {
          try {
            await transaction.rollback();
          } catch (rbErr) {
            console.error("Rollback hatası:", rbErr);
          }
        }
        return res.redirect(303, "/odeme-hata.html");
      }
    }
  );
});

// Kargo durum sorgulama – "Kargom Nerede?"
app.get("/api/shipping/status/:cargoKey", async (req, res) => {
  try {
    const { cargoKey } = req.params;

    if (!cargoKey) {
      return res.status(400).json({ ok: false, error: "cargoKey zorunludur." });
    }

    const result = await queryYurticiKargoShipment(cargoKey);

    if (!result.success) {
      return res.status(500).json({
        ok: false,
        error: result.error || "Yurtiçi kargo sorgusu başarısız.",
      });
    }

    return res.json({
      ok: true,
      statusText: result.statusText,
      summary: result.summary,
    });
  } catch (err) {
    console.error("GET /api/shipping/status HATA:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası" });
  }
});

// Sipariş detaylarını getir (ödeme sonrası sayfada göstermek için)
app.get("/api/orders/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, error: "Geçersiz sipariş numarası." });
    }

    const pool = await getPool();

    // Ana sipariş
    const orderRes = await pool
      .request()
      .input("Id", sql.Int, id)
      .query(`
        SELECT TOP 1
          Id,
          UserId,
          TotalPrice,
          PaidPrice,
          TrackingNumber,
          CreatedAt
        FROM dbo.Orders
        WHERE Id = @Id
      `);

    if (!orderRes.recordset.length) {
      return res.status(404).json({ ok: false, error: "Sipariş bulunamadı." });
    }

    const order = orderRes.recordset[0];

    // Kalemler
    const itemsRes = await pool
      .request()
      .input("OrderId", sql.Int, id)
      .query(`
        SELECT
          ProductName,
          Quantity,
          UnitPrice,
          TotalPrice
        FROM dbo.OrderItems
        WHERE OrderId = @OrderId
      `);

    return res.json({
      ok: true,
      order,
      items: itemsRes.recordset || [],
    });
  } catch (err) {
    console.error("GET /api/orders/:id error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

/* ---------------- API: Password Update ---------------- */
app.post("/api/account/password", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const { current_password, new_password, new_password_confirm } = req.body;

  if (!new_password || new_password.length < 8) {
    return res.status(400).json({ error: "Yeni şifre en az 8 karakter olmalı." });
  }

  if (new_password !== new_password_confirm) {
    return res.status(400).json({ error: "Yeni şifreler uyuşmuyor." });
  }

  try {
    const pool = await getPool();

    // Eski şifreyi çek
    const result = await pool
      .request()
      .input("id", sql.Int, userId)
      .query(`
        SELECT PasswordHash
        FROM dbo.Users
        WHERE Id = @id
      `);

    if (!result.recordset.length) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }

    const user = result.recordset[0];

    // Mevcut şifre gönderilmişse doğrula
    if (current_password) {
      const ok = await bcrypt.compare(current_password, user.PasswordHash);
      if (!ok) {
        return res.status(401).json({ error: "Mevcut şifre hatalı." });
      }
    }

    // Yeni şifreyi hash'le
    const newHash = await bcrypt.hash(new_password, 12);

    // DB'ye yaz
    await pool
      .request()
      .input("id", sql.Int, userId)
      .input("hash", sql.NVarChar(255), newHash)
      .query(`
        UPDATE dbo.Users
        SET PasswordHash = @hash
        WHERE Id = @id
      `);

    return res.json({ ok: true, message: "Şifre güncellendi." });
  } catch (err) {
    console.error("Password update error:", err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});

// Kullanıcının kendi siparişlerini getir
app.get("/api/my/orders", async (req, res) => {
  try {
    const sess = getSession(req);
    console.log("🔐 /api/my/orders session:", sess);
    const userId = sess?.userId;

    if (!userId) {
      return res.status(401).json({
        ok: false,
        error: "Siparişleri görmek için giriş yapmalısınız.",
      });
    }

    const pool = await getPool();
    const result = await pool
      .request()
      .input("UserId", sql.Int, userId)
      .query(`
        SELECT 
          o.Id,
          o.TotalPrice,
          o.PaidPrice,
          o.TrackingNumber,
          o.CreatedAt,
          COUNT(oi.Id) AS ItemCount
        FROM dbo.Orders o
        LEFT JOIN dbo.OrderItems oi ON oi.OrderId = o.Id
        WHERE o.UserId = @UserId
        GROUP BY 
          o.Id, o.TotalPrice, o.PaidPrice, 
          o.TrackingNumber, o.CreatedAt
        ORDER BY o.CreatedAt DESC
      `);

    return res.json({
      ok: true,
      orders: result.recordset || [],
    });
  } catch (err) {
    console.error("GET /api/my/orders error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

// Admin: ürün resmi yükleme (file input'tan çağrılacak)
app.post(
  "/api/admin/upload-product-image",
  requireAdmin,
  productUpload.single("image"), // <- önemli: productUpload ve field name "image"
  (req, res) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ ok: false, error: "Dosya alınamadı." });
      }

      // Tarayıcıdan erişilecek URL:
      const url = `/uploads/products/${req.file.filename}`;
      return res.json({ ok: true, url });
    } catch (err) {
      console.error("upload-product-image error:", err);
      res.status(500).json({ ok: false, error: "Yükleme sırasında hata." });
    }
  }
);


// Admin: ürüne teknik görsel yükleme
app.post(
  "/api/admin/products/:id/images",
  requireAdmin,
  productUpload.single("image"),
  async (req, res) => {
    try {
      const productId = Number(req.params.id);
      if (!productId) {
        return res
          .status(400)
          .json({ ok: false, error: "Geçersiz ürün ID." });
      }
      if (!req.file) {
        return res
          .status(400)
          .json({ ok: false, error: "Dosya alınamadı." });
      }

      const url = `/uploads/products/${req.file.filename}`;

      const pool = await getPool();
      await pool
        .request()
        .input("ProductId", sql.Int, productId)
        .input("ImageUrl", sql.NVarChar, url)
        .query(`
          INSERT INTO dbo.ProductImages (ProductId, ImageUrl)
          VALUES (@ProductId, @ImageUrl);
        `);

      return res.json({ ok: true, url });
    } catch (err) {
      console.error("POST /api/admin/products/:id/images error:", err);
      res
        .status(500)
        .json({ ok: false, error: "Yükleme sırasında hata." });
    }
  }
);

// Admin: ürüne ait teknik görselleri listele
app.get("/api/admin/products/:id/images", requireAdmin, async (req, res) => {
  try {
    const productId = Number(req.params.id);
    if (!productId) {
      return res
        .status(400)
        .json({ ok: false, error: "Geçersiz ürün ID." });
    }

    const pool = await getPool();
    const r = await pool
      .request()
      .input("ProductId", sql.Int, productId)
      .query(`
        SELECT Id, ImageUrl, CreatedAt
        FROM dbo.ProductImages
        WHERE ProductId = @ProductId
        ORDER BY CreatedAt ASC
      `);

    return res.json({ ok: true, images: r.recordset });
  } catch (err) {
    console.error("GET /api/admin/products/:id/images error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

// Admin: teknik görsel sil
app.delete(
  "/api/admin/products/:productId/images/:imageId",
  requireAdmin,
  async (req, res) => {
    try {
      const productId = Number(req.params.productId);
      const imageId = Number(req.params.imageId);
      if (!productId || !imageId) {
        return res
          .status(400)
          .json({ ok: false, error: "Geçersiz ID." });
      }

      const pool = await getPool();
      await pool
        .request()
        .input("Id", sql.Int, imageId)
        .input("ProductId", sql.Int, productId)
        .query(`
          DELETE FROM dbo.ProductImages
          WHERE Id = @Id AND ProductId = @ProductId
        `);

      return res.json({ ok: true });
    } catch (err) {
      console.error(
        "DELETE /api/admin/products/:productId/images/:imageId error:",
        err
      );
      res.status(500).json({ ok: false, error: "Sunucu hatası." });
    }
  }
);
/* ---------------- ADMIN: Ürüne teknik görsel ekle ---------------- */
app.post(
  "/api/admin/products/:id/detail-images",
  requireAdmin,
  productUpload.single("image"),
  async (req, res) => {
    const productId = parseInt(req.params.id, 10);
    if (!productId) {
      return res.status(400).json({ ok: false, error: "Geçersiz ürün Id." });
    }
    if (!req.file) {
      return res.status(400).json({ ok: false, error: "Görsel dosyası gerekli." });
    }

    const caption = String(req.body.caption || "").trim();
    const relPath = "/uploads/products/" + req.file.filename;

    try {
      const pool = await getPool();
      const r = await pool
        .request()
        .input("ProductId", sql.Int, productId)
        .input("ImageUrl", sql.NVarChar(400), relPath)
        .input("Caption", sql.NVarChar(200), caption || null)
        .query(`
          INSERT INTO dbo.ProductDetailImages (ProductId, ImageUrl, Caption)
          OUTPUT INSERTED.*
          VALUES (@ProductId, @ImageUrl, @Caption);
        `);

      return res.json({ ok: true, image: r.recordset[0] });
    } catch (err) {
      console.error("POST /api/admin/products/:id/detail-images error:", err);
      return res.status(500).json({ ok: false, error: "Sunucu hatası." });
    }
  }
);

/* ---------------- ADMIN: Ürünün teknik görsellerini listele ---------------- */
app.get(
  "/api/admin/products/:id/detail-images",
  requireAdmin,
  async (req, res) => {
    const productId = parseInt(req.params.id, 10);
    if (!productId) {
      return res.status(400).json({ ok: false, error: "Geçersiz ürün Id." });
    }

    try {
      const pool = await getPool();
      const r = await pool
        .request()
        .input("ProductId", sql.Int, productId)
        .query(`
          SELECT Id, ProductId, ImageUrl, Caption, SortOrder, CreatedAt
          FROM dbo.ProductDetailImages
          WHERE ProductId = @ProductId
          ORDER BY SortOrder, Id;
        `);

      return res.json({ ok: true, images: r.recordset });
    } catch (err) {
      console.error("GET /api/admin/products/:id/detail-images error:", err);
      return res.status(500).json({ ok: false, error: "Sunucu hatası." });
    }
  }
);

/* ---------------- ADMIN: Teknik görsel sil ---------------- */
app.delete(
  "/api/admin/products/:id/detail-images/:imageId",
  requireAdmin,
  async (req, res) => {
    const productId = parseInt(req.params.id, 10);
    const imageId = parseInt(req.params.imageId, 10);

    if (!productId || !imageId) {
      return res.status(400).json({ ok: false, error: "Geçersiz parametre." });
    }

    try {
      const pool = await getPool();
      await pool
        .request()
        .input("Id", sql.Int, imageId)
        .input("ProductId", sql.Int, productId)
        .query(`
          DELETE FROM dbo.ProductDetailImages
          WHERE Id = @Id AND ProductId = @ProductId;
        `);

      return res.json({ ok: true });
    } catch (err) {
      console.error("DELETE /api/admin/products/:id/detail-images/:imageId error:", err);
      return res.status(500).json({ ok: false, error: "Sunucu hatası." });
    }
  }
);

/* ---------------- PUBLIC: Ürünün teknik görselleri ---------------- */
app.get("/api/products/:id/detail-images", async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  if (!productId) {
    return res.status(400).json({ ok: false, error: "Geçersiz ürün Id." });
  }

  try {
    const pool = await getPool();
    const r = await pool
      .request()
      .input("ProductId", sql.Int, productId)
      .query(`
        SELECT Id, ProductId, ImageUrl, Caption, SortOrder
        FROM dbo.ProductDetailImages
        WHERE ProductId = @ProductId
        ORDER BY SortOrder, Id;
      `);

    return res.json({ ok: true, images: r.recordset });
  } catch (err) {
    console.error("GET /api/products/:id/detail-images error:", err);
    return res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

// Kullanıcı: bir ürünün teknik/ekstra görselleri
app.get("/api/products/:id/images", async (req, res) => {
  try {
    const productId = Number(req.params.id);
    if (!productId) {
      return res
        .status(400)
        .json({ ok: false, error: "Geçersiz ürün ID." });
    }

    const pool = await getPool();
    const r = await pool
      .request()
      .input("ProductId", sql.Int, productId)
      .query(`
        SELECT Id, ImageUrl, CreatedAt
        FROM dbo.ProductImages
        WHERE ProductId = @ProductId
        ORDER BY CreatedAt ASC
      `);

    return res.json({ ok: true, images: r.recordset });
  } catch (err) {
    console.error("GET /api/products/:id/images error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});


// ================== ADMIN PRODUCTS ==================

// Admin: tüm ürünleri listele (basit, istersen pagination ekleyebiliriz)
app.get("/api/admin/products", requireAdmin, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        Id,
        Name,
        Slug,
        Description,
        Price,
        Stock,
        ImageUrl,
        Category,
        IsActive,
        CreatedAt,
        UpdatedAt
      FROM dbo.Products
      ORDER BY CreatedAt DESC
    `);

    res.json({ ok: true, products: result.recordset });
  } catch (err) {
    console.error("GET /api/admin/products error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

// Admin: yeni ürün ekle
app.post("/api/admin/products", requireAdmin, async (req, res) => {
  try {
    const { name, slug, description, price, stock, imageUrl, category, isActive } =
      req.body || {};

    if (!name || !slug) {
      return res.status(400).json({ ok: false, error: "Name ve slug zorunludur." });
    }

    const pool = await getPool();
    const insert = await pool
      .request()
      .input("Name", sql.NVarChar(200), name)
      .input("Slug", sql.NVarChar(200), slug)
      .input("Description", sql.NVarChar(sql.MAX), description || null)
      .input("Price", sql.Decimal(18, 2), Number(price || 0))
      .input("Stock", sql.Int, Number(stock || 0))
      .input("ImageUrl", sql.NVarChar(400), imageUrl || null)
      .input("Category", sql.NVarChar(100), category || null)
      .input("IsActive", sql.Bit, isActive === false ? 0 : 1)
      .query(`
        INSERT INTO dbo.Products
          (Name, Slug, Description, Price, Stock, ImageUrl, Category, IsActive, CreatedAt)
        OUTPUT INSERTED.*
        VALUES
          (@Name, @Slug, @Description, @Price, @Stock, @ImageUrl, @Category, @IsActive, SYSUTCDATETIME())
      `);

    res.status(201).json({ ok: true, product: insert.recordset[0] });
  } catch (err) {
    console.error("POST /api/admin/products error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

// Admin: ürün güncelle
app.put("/api/admin/products/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, error: "Geçersiz ürün ID." });
    }

    const { name, slug, description, price, stock, imageUrl, category, isActive } =
      req.body || {};

    const pool = await getPool();
    const update = await pool
      .request()
      .input("Id", sql.Int, id)
      .input("Name", sql.NVarChar(200), name)
      .input("Slug", sql.NVarChar(200), slug)
      .input("Description", sql.NVarChar(sql.MAX), description || null)
      .input("Price", sql.Decimal(18, 2), Number(price || 0))
      .input("Stock", sql.Int, Number(stock || 0))
      .input("ImageUrl", sql.NVarChar(400), imageUrl || null)
      .input("Category", sql.NVarChar(100), category || null)
      .input("IsActive", sql.Bit, isActive ? 1 : 0)
      .query(`
        UPDATE dbo.Products
        SET
          Name        = @Name,
          Slug        = @Slug,
          Description = @Description,
          Price       = @Price,
          Stock       = @Stock,
          ImageUrl    = @ImageUrl,
          Category    = @Category,
          IsActive    = @IsActive,
          UpdatedAt   = SYSUTCDATETIME()
        WHERE Id = @Id;

        SELECT *
        FROM dbo.Products
        WHERE Id = @Id;
      `);

    if (!update.recordset.length) {
      return res.status(404).json({ ok: false, error: "Ürün bulunamadı." });
    }

    res.json({ ok: true, product: update.recordset[0] });
  } catch (err) {
    console.error("PUT /api/admin/products/:id error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

// Admin: ürün sil (istersen soft delete yap)
app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, error: "Geçersiz ürün ID." });
    }

    const pool = await getPool();
    await pool
      .request()
      .input("Id", sql.Int, id)
      .query(`
        DELETE FROM dbo.Products
        WHERE Id = @Id
      `);

    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/admin/products/:id error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

// Üyeler listesi (admin)
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const pool = await getPool();
    const r = await pool.request().query(`
      SELECT Id, FullName, Email
      FROM dbo.Users
      ORDER BY Id DESC
    `);

    return res.json({ ok: true, users: r.recordset });
  } catch (e) {
    console.error("GET /api/admin/users error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Sunucu hatası" });
  }
});


// ================== ADMIN ORDERS ==================

// Admin: tüm siparişleri listele
app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        o.Id,
        o.UserId,
        o.TotalPrice,
        o.PaidPrice,
        o.TrackingNumber,
        o.PaymentStatus,
        o.CreatedAt,
        COUNT(oi.Id) AS ItemCount
      FROM dbo.Orders o
      LEFT JOIN dbo.OrderItems oi ON oi.OrderId = o.Id
      GROUP BY
        o.Id, o.UserId, o.TotalPrice, o.PaidPrice,
        o.TrackingNumber, o.PaymentStatus, o.CreatedAt
      ORDER BY o.CreatedAt DESC
    `);

    res.json({ ok: true, orders: result.recordset });
  } catch (err) {
    console.error("GET /api/admin/orders error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

// Admin: tek bir sipariş ve kalemleri
app.get("/api/admin/orders/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, error: "Geçersiz sipariş ID." });
    }

    const pool = await getPool();

    const orderRes = await pool
      .request()
      .input("Id", sql.Int, id)
      .query(`
        SELECT
          o.Id,
          o.UserId,
          o.TotalPrice,
          o.PaidPrice,
          o.TrackingNumber,
          o.PaymentStatus,
          o.CreatedAt
        FROM dbo.Orders o
        WHERE o.Id = @Id
      `);

    if (!orderRes.recordset.length) {
      return res.status(404).json({ ok: false, error: "Sipariş bulunamadı." });
    }

    const itemsRes = await pool
      .request()
      .input("OrderId", sql.Int, id)
      .query(`
        SELECT
          ProductId,
          ProductName,
          Quantity,
          UnitPrice,
          TotalPrice
        FROM dbo.OrderItems
        WHERE OrderId = @OrderId
      `);

    res.json({
      ok: true,
      order: orderRes.recordset[0],
      items: itemsRes.recordset,
    });
  } catch (err) {
    console.error("GET /api/admin/orders/:id error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

// Admin: sipariş durumunu güncelle (ör: shipped, cancelled)
app.put("/api/admin/orders/:id/status", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body || {};
    if (!id || !status) {
      return res.status(400).json({ ok: false, error: "Geçersiz parametre." });
    }

    const pool = await getPool();
    const r = await pool
      .request()
      .input("Id", sql.Int, id)
      .input("Status", sql.NVarChar(20), status)
      .query(`
        UPDATE dbo.Orders
        SET PaymentStatus = @Status
        WHERE Id = @Id;

        SELECT *
        FROM dbo.Orders
        WHERE Id = @Id;
      `);

    if (!r.recordset.length) {
      return res.status(404).json({ ok: false, error: "Sipariş bulunamadı." });
    }

    res.json({ ok: true, order: r.recordset[0] });
  } catch (err) {
    console.error("PUT /api/admin/orders/:id/status error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

// ================== PUBLIC PRODUCTS ==================

// Tüm aktif ürünler
app.get("/api/products", async (req, res) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      SELECT
        Id,
        Name,
        Slug,
        Description,
        Price,
        Stock,
        ImageUrl,
        Category
      FROM dbo.Products
      WHERE IsActive = 1
      ORDER BY CreatedAt DESC
    `);

    res.json({ ok: true, products: result.recordset });
  } catch (err) {
    console.error("GET /api/products error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

// Tek ürün (slug ile veya id ile)
app.get("/api/products/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, error: "Geçersiz ürün ID." });
    }
    const pool = await getPool();
    const result = await pool
      .request()
      .input("Id", sql.Int, id)
      .query(`
        SELECT
          Id,
          Name,
          Slug,
          Description,
          Price,
          Stock,
          ImageUrl,
          Category
        FROM dbo.Products
        WHERE Id = @Id AND IsActive = 1
      `);

    if (!result.recordset.length) {
      return res.status(404).json({ ok: false, error: "Ürün bulunamadı." });
    }

    res.json({ ok: true, product: result.recordset[0] });
  } catch (err) {
    console.error("GET /api/products/:id error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

// /admin => admin panel HTML (SPA)
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
});

/* ---------------- Start ---------------- */
app.listen(PORT, () => {
  console.log(`✅ Server çalışıyor: http://localhost:${PORT}`);
});
