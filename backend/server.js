import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import bcrypt from "bcrypt";
import validator from "validator";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { query as dbQuery, pool as pgPool } from "./db.postgres.js";
import Iyzipay from "iyzipay";
import dotenv from "dotenv";
dotenv.config();
import soap from "soap";
import multer from "multer";
import nodemailer from "nodemailer";
import puppeteer from "puppeteer";

const iyzipay = new Iyzipay({
  apiKey: "sandbox-eI51Rj7CHjWCLrtxy58lwmYRkMH492sq",
  secretKey: "sandbox-KGgGkoD9KZWPnK4ZIyZqQ5V33oYBFmuP",
  uri: process.env.IYZICO_BASE_URL,
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
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB (ideal)
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
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    hsts: false, // SSL yokken HSTS KAPALI  
    contentSecurityPolicy: false,
  })
);
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
    secure: false,
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

  // PostgreSQL üzerinden sorgu
  const r = await dbQuery(
    `
    SELECT
      id,
      fullname,
      email,
      isadmin
    FROM users
    WHERE id = $1
    `,
    [sess.userId]
  );

  if (r.rows.length === 0) return null;

  const user = r.rows[0];
  if (!user.isadmin) return null;

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
    // 1) E-posta var mı?
    const existing = await dbQuery(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );

    if (existing.rows.length > 0) {
      return res.status(409).json({
        fieldErrors: { email: "Bu e-posta ile kayıt var." },
      });
    }

    const hash = await bcrypt.hash(password, 12);
    // 3) Yeni kullanıcıyı ekle
    const insert = await dbQuery(
      `
      INSERT INTO users (fullname, email, passwordhash, createdat, isadmin)
      VALUES ($1, $2, $3, NOW(), false)
      RETURNING id
      `,
      [full_name, email, hash]
    );

    const newId = insert.rows[0].id;
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
    // 1) Kullanıcıyı e-posta ile çek
    const result = await dbQuery(
      `
      SELECT id, email, passwordhash
      FROM users
      WHERE LOWER(email) = $1
      LIMIT 1
      `,
      [identifier]
    );

    // 2) Kayıt yoksa
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ fieldErrors: { identifier: "Kayıt bulunamadı." } });
    }

    const user = result.rows[0];

    // 3) Şifre kolonunda veri yoksa
    if (!user.passwordhash) {      // kolon adını burada düzelt: passwordhash / password_hash
      return res
        .status(500)
        .json({
          message:
            "Hesapta şifre verisi eksik. Lütfen hesabı yeniden oluşturun.",
        });
    }

    // 4) Şifreyi kontrol et
    const ok = await bcrypt.compare(password, user.passwordhash);
    if (!ok) {
      return res
        .status(401)
        .json({ fieldErrors: { password: "Şifre hatalı." } });
    }

    setSession(res, {
      userId: user.id,
      isAdmin: user.isadmin, // istersen kullanırsın
    });

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
    const referencesText = String(body.references || "").trim() || null;
    const otherNotes = String(body.otherNotes || "").trim() || null;
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

    if (!lastSchool)
      fieldErrors.lastSchool =
        "Son mezun olduğunuz okul ve bölüm zorunludur.";

    if (!languages) fieldErrors.languages = "Yabancı dil bilgisi zorunludur.";
    if (!desiredDepartment)
      fieldErrors.desiredDepartment =
        "Çalışmak istediğiniz bölüm zorunludur.";

    if (!approval) {
      fieldErrors.approval =
        "Başvuruyu tamamlamak için beyan ettiğiniz bilgilerin doğruluğunu onaylamalısınız.";
    }

    // Dosya bilgisi (isteğe bağlı)
    const cvFile = req.file || null;
    const cvFileName = cvFile ? cvFile.originalname : null;
    const cvFilePath = cvFile ? cvFile.path : null;

    if (Object.keys(fieldErrors).length > 0) {
      return res.status(400).json({
        ok: false,
        message: "Lütfen formu kontrol edin.",
        fieldErrors,
      });
    }

    try {
      // 🔹 BURASI ARTIK PostgreSQL
      await dbQuery(
        `
      INSERT INTO jobapplications (
        firstname,
        lastname,
        email,
        birthdate,
        phone,
        address,
        educationlevel,
        lastschool,
        militarystatus,
        drivinglicense,
        languages,
        desireddepartment,
        desireddepartmentother,
        criminalrecord,
        referencestext,
        othernotes,
        cvfilename,
        cvfilepath,
        ipaddress,
        createdat
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19, NOW()
      )
      `,
        [
          firstName,
          lastName,
          email,
          birthDateValue,
          phone,
          address,
          educationLevel,
          lastSchool,
          militaryStatus,
          drivingLicense,
          languages,
          desiredDepartment,
          desiredDepartmentOther,
          criminalRecord,
          referencesText,
          otherNotes,
          cvFileName,
          cvFilePath,
          req.ip || null,
        ]
      );

      // 2) PDF Oluşturma ve Mail Gönderimi
      try {
        // CSS dosyasını oku
        const cssPath = path.join(__dirname, "..", "public", "css", "is-basvuru.css");
        let cssContent = "";
        if (fs.existsSync(cssPath)) {
            cssContent = fs.readFileSync(cssPath, "utf8");
        }

        // HTML Şablonu
        const htmlTemplate = `
        <html>
        <head>
            <style>
                ${cssContent}
                body { background: #fff !important; font-family: sans-serif; padding: 40px; }
                .job-form-section { border: 1px solid #ddd; padding: 20px; box-shadow: none; margin-top: 20px; }
                .label { font-weight: bold; color: #333; display: inline-block; width: 180px; }
                .value { display: inline-block; color: #555; }
                .row { margin-bottom: 12px; border-bottom: 1px solid #eee; padding-bottom: 8px; }
                h1 { border-bottom: 2px solid #2563eb; padding-bottom: 10px; margin-bottom: 20px; color: #333; }
                h2 { margin-top: 30px; font-size: 18px; background: #f4f5f7; padding: 10px; border-left: 5px solid #2563eb; }
                .header { text-align: center; margin-bottom: 30px; }
            </style>
        </head>
        <body>
            <div class="header">
                <img src="https://www.dronetech.com.tr/assets/logo-white.png" style="background:#000; padding:15px; width:200px; border-radius: 5px;">
            </div>
            
            <h1>İş Başvuru Formu</h1>
            <p><strong>Başvuru Tarihi:</strong> ${new Date().toLocaleDateString("tr-TR")}</p>

            <h2>Kişisel Bilgiler</h2>
            <div class="job-form-section">
                <div class="row"><span class="label">Ad Soyad:</span> <span class="value">${firstName} ${lastName}</span></div>
                <div class="row"><span class="label">Doğum Tarihi:</span> <span class="value">${birthDateStr}</span></div>
                <div class="row"><span class="label">Telefon:</span> <span class="value">${phone}</span></div>
                <div class="row"><span class="label">E-Posta:</span> <span class="value">${email}</span></div>
                <div class="row"><span class="label">Adres:</span> <span class="value">${address}</span></div>
            </div>

            <h2>Eğitim ve Nitelikler</h2>
            <div class="job-form-section">
                <div class="row"><span class="label">Öğrenim Durumu:</span> <span class="value">${educationLevel || "-"}</span></div>
                <div class="row"><span class="label">Son Okul / Bölüm:</span> <span class="value">${lastSchool}</span></div>
                <div class="row"><span class="label">Yabancı Diller:</span> <span class="value">${languages}</span></div>
            </div>

            <h2>Başvuru Detayları</h2>
            <div class="job-form-section">
                <div class="row"><span class="label">Başvurulan Bölüm:</span> <span class="value">${desiredDepartment} ${desiredDepartmentOther ? `(${desiredDepartmentOther})` : ""}</span></div>
                <div class="row"><span class="label">Askerlik Durumu:</span> <span class="value">${militaryStatus || "-"}</span></div>
                <div class="row"><span class="label">Ehliyet:</span> <span class="value">${drivingLicense || "-"}</span></div>
                <div class="row"><span class="label">Adli Sicil Kaydı:</span> <span class="value">${criminalRecord}</span></div>
            </div>
            
            <h2>Ek Bilgiler</h2>
            <div class="job-form-section">
                <div class="row" style="display:block;">
                    <div class="label" style="margin-bottom:5px;">Referanslar:</div>
                    <div class="value" style="display:block; white-space: pre-wrap;">${referencesText || "-"}</div>
                </div>
                <div class="row" style="display:block;">
                    <div class="label" style="margin-bottom:5px;">Diğer Notlar:</div>
                    <div class="value" style="display:block; white-space: pre-wrap;">${otherNotes || "-"}</div>
                </div>
            </div>
            
            <div style="margin-top:50px; font-size:12px; color:#999; text-align:center; border-top: 1px solid #eee; padding-top: 20px;">
                Bu belge Dronetech Web Sitesi üzerinden otomatik oluşturulmuştur.<br>
                IP Adresi: ${req.ip || "-"}
            </div>
        </body>
        </html>
        `;

        // Puppeteer Başlat ve PDF'e Çevir
        const browser = await puppeteer.launch({ 
            headless: true, 
            args: ["--no-sandbox", "--disable-setuid-sandbox"] 
        });
        const page = await browser.newPage();
        await page.setContent(htmlTemplate, { waitUntil: "networkidle0" });
        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" }
        });
        await browser.close();

        // Mail Gönderimi
        const notifyTo = process.env.JOB_APP_NOTIFY_TO || process.env.SMTP_USER;
        const subject = `Yeni İş Başvurusu: ${firstName} ${lastName} - ${desiredDepartment}`;

        // Mail Eklentilerini Hazırla
        const attachments = [
            {
                filename: `Basvuru_Formu_${firstName}_${lastName}.pdf`,
                content: pdfBuffer,
                contentType: "application/pdf"
            }
        ];

        // Kullanıcı kendi CV'sini yüklediyse onu da ekle
        if (cvFilePath && cvFileName) {
            attachments.push({
                filename: `Orijinal_CV_${cvFileName}`,
                path: cvFilePath
            });
        }

        await mailTransporter.sendMail({
            from: `"Dronetech İK" <${process.env.SMTP_USER}>`,
            to: notifyTo,
            subject: subject,
            html: `
                <h3>Yeni bir iş başvurusu alındı.</h3>
                <p><strong>Aday:</strong> ${firstName} ${lastName}</p>
                <p><strong>Bölüm:</strong> ${desiredDepartment}</p>
                <p>Başvuru formu PDF formatında oluşturulmuş ve ekte sunulmuştur.</p>
                <p>Adayın yüklediği orijinal CV (varsa) ayrıca ektedir.</p>
            `,
            attachments: attachments
        });

      } catch (pdfErr) {
        console.error("PDF/Mail İşlemleri Hatası:", pdfErr);
      }

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
    // 1) Veritabanına kaydet (PostgreSQL)
    await dbQuery(
      `
    INSERT INTO contactmessages (
      firstname,
      lastname,
      email,
      subject,
      message,
      ipaddress,
      createdat
    )
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `,
      [
        firstName,
        lastName,
        email,
        subject,
        messageText,
        req.ip || null,
      ]
    );
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
        replyTo: email,
        subject: mailSubject,
        text: textBody,
        html: htmlBody,
      });
    } catch (mailErr) {
      console.error("İletişim maili gönderilemedi:", mailErr);
    }

    return res.status(201).json({
      ok: true,
      message:
        "Mesajınız başarıyla gönderildi. En kısa sürede sizinle iletişime geçilecektir.",
    });
  } catch (err) {
    console.error("POST /api/contact error:", err);
    return res.status(500).json({
      ok: false,
      message: "Sunucu hatası, lütfen daha sonra tekrar deneyin.",
    });
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
    // Kullanıcı var mı?
    const userRes = await dbQuery(
      `
    SELECT id
    FROM users
    WHERE LOWER(email) = $1
    LIMIT 1
    `,
      [email]
    );
    if (userRes.rows.length === 0) {
      return res.status(404).json({
        fieldErrors: { email: "Bu e-posta ile kayıt bulunamadı." },
      });
    }
    const userId = userRes.rows[0].id;
    const hash = await bcrypt.hash(newPassword, 12);
    await dbQuery(
      `
    UPDATE users
    SET passwordhash = $1
    WHERE id = $2
    `,
      [hash, userId]
    );
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
    const r = await dbQuery(
      `
      SELECT
        id,
        fullname,
        email,
        createdat
      FROM users
      WHERE id = $1
      `,
      [sess.userId]
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }

    res.json({ user: r.rows[0] });
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
        id: admin.id,
        fullName: admin.fullname,  // <<< BURASI ÖNEMLİ
        email: admin.email,
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
    const result = await dbQuery(
      `
      SELECT *
      FROM useraddresses
      WHERE userid = $1 AND type = 'shipping'
      ORDER BY id DESC
      LIMIT 1
      `,
      [userId]
    );

    res.json({ address: result.rows[0] || null });
  } catch (err) {
    console.error("GET /api/addresses error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.set("trust proxy", 1);

// POST /api/payments/iyzico/init  → iyzico ödeme başlat (PostgreSQL sürümü)
app.post("/api/payments/iyzico/init", async (req, res) => {
  try {
    console.log("Iyzico init body:", req.body);

    const { subtotal, totalPrice, shippingFee, cart, address } = req.body || {};

    const sub = Number(subtotal || 0);
    const ship = Number(shippingFee || 0);
    const total = Number(totalPrice || 0);

    if (!sub || !cart || !cart.length) {
      return res.status(400).json({ ok: false, error: "Sepet veya tutar yok." });
    }

    // 🔹 Oturumdan userId almaya çalış
    const sess = getSession(req);
    const userId = sess?.userId || null;

    // ✅ Proxy uyumlu baseUrl + buyerIp (SUNUCUDA HATA 11’i genelde bu çözer)
    // ✅ Proxy uyumlu baseUrl (prod'da HTTPS'e sabitle)
    const host = req.get("host");
    const forwardedProto = (req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    const proto =
      forwardedProto ||
      (req.protocol ? String(req.protocol) : "http");

    // BASE_URL varsa onu kullan (en sağlam yöntem)
    const baseUrl =
      process.env.BASE_URL
        ? process.env.BASE_URL.replace(/\/+$/, "")
        : (host && (host.includes("localhost") || host.startsWith("127.0.0.1")))
          ? `${proto}://${host}`        // localde http/https neyse
          : `https://${host}`;          // canlıda kesin https


    const xf = req.headers["x-forwarded-for"];
    const buyerIp = (xf ? xf.split(",")[0].trim() : req.socket.remoteAddress || "")
      .replace("::ffff:", "") || "85.105.0.1";

    // 🔹 1) PendingOrders'a geçici siparişi kaydet (PostgreSQL)
    const pendingResult = await dbQuery(
      `
      INSERT INTO pendingorders (
        userid,
        totalprice,
        cartjson,
        addressjson,
        shippingfee,
        createdat,
        status,
        updatedat
      )
      VALUES ($1, $2, $3, $4, $5, NOW(),'pending',NOW())
      RETURNING id
      `,
      [
        userId,
        total,
        JSON.stringify(cart || []),
        JSON.stringify(address || {}),
        ship,
      ]
    );

    const pendingId = pendingResult.rows[0].id;
    console.log("💾 PendingOrders insert Id:", pendingId);

    const conversationId = String(pendingId);
    const basketId = "BASKET_" + pendingId;

    // 🔹 2) İyzico buyer & adres & sepet
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
      ip: buyerIp,
    };

    const shippingAddress = {
      contactName: `${address?.firstName || "Ad"} ${address?.lastName || "Soyad"}`,
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
        price: (price * qty).toFixed(2),
      };
    });

    // 🔹 3) İyzico checkout form initialize isteği
    const request = {
      locale: Iyzipay.LOCALE.TR,
      conversationId,
      price: sub.toFixed(2),
      paidPrice: total.toFixed(2),
      currency: Iyzipay.CURRENCY.TRY,
      basketId,
      paymentGroup: Iyzipay.PAYMENT_GROUP.PRODUCT,

      // ✅ localhost hardcode YOK! sunucuda otomatik doğru olur
      callbackUrl: `${baseUrl}/iyzico-callback`,

      buyer,
      shippingAddress,
      billingAddress,
      basketItems,
    };

    console.log("IYZICO init callbackUrl:", request.callbackUrl);
    console.log("IYZICO init buyerIp:", buyer.ip);

    iyzipay.checkoutFormInitialize.create(request, async (err, result) => {
      try {
        if (err) {
          console.error("iyzico init error:", err);
          return res.status(500).json({ ok: false, error: "İyzico isteği başarısız." });
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

        await dbQuery(
          `
          UPDATE pendingorders
          SET iyzicotoken = $1
          WHERE id = $2
          `,
          [token, pendingId]
        );

        return res.json({
          ok: true,
          paymentPageUrl: result.paymentPageUrl,
          paymentId: result.paymentId,
        });
      } catch (innerErr) {
        console.error("iyzico init içinde hata:", innerErr);
        return res.status(500).json({ ok: false, error: "Sunucu hatası (init)" });
      }
    });
  } catch (e) {
    console.error("iyzico init catch:", e);
    return res.status(500).json({ ok: false, error: "Sunucu hatası" });
  }
});

// ✅ Havale/EFT siparişi oluştur
app.post("/api/orders/transfer/create", async (req, res) => {
  try {
    const { subtotal, totalPrice, shippingFee, cart, address } = req.body || {};

    const sub = Number(subtotal || 0);
    const ship = Number(shippingFee || 0);
    const total = Number(totalPrice || 0);

    if (!cart || !cart.length) {
      return res.status(400).json({ ok: false, error: "Sepet boş." });
    }
    if (!total || total <= 0) {
      return res.status(400).json({ ok: false, error: "Toplam tutar hatalı." });
    }
    if (!address) {
      return res.status(400).json({ ok: false, error: "Adres bilgisi yok." });
    }

    // oturum varsa userId al, yoksa guest olsun
    const sess = getSession(req);
    const userId = sess?.userId || null;

    let client;
    try {
      client = await pgPool.connect();
      await client.query("BEGIN");

      // 1) orders'a "ödeme bekleniyor" sipariş kaydı aç
      const orderInsertRes = await client.query(
        `
        INSERT INTO orders (
          userid, totalprice, paidprice,
          paymentid, paymentstatus,
          conversationid, basketid, iyzicotoken, currency,
          trackingnumber, createdat, shippingfee, status
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11,$12)
        RETURNING id
        `,
        [
          userId,
          total,
          0,                         // paidprice = 0 (ödeme bekliyor)
          null,                      // paymentid
          "PENDING_TRANSFER",        // paymentstatus
          "TRANSFER",                // conversationid
          "TRANSFER",                // basketid
          null,                      // iyzicotoken
          "TRY",                     // currency (istersen frontend’den aldırırız)
          null,                      // trackingnumber
          ship,                      // shippingfee
          "awaiting_payment",        // status (admin panelde göreceksin)
        ]
      );

      const orderId = orderInsertRes.rows[0].id;

      // 2) orderitems'e ürünleri yaz
      for (const item of cart) {
        const qty = Number(item.qty || 1);
        const price = Number(item.price || 0);
        await client.query(
          `
          INSERT INTO orderitems (orderid, productid, productname, quantity, unitprice, totalprice)
          VALUES ($1,$2,$3,$4,$5,$6)
          `,
          [orderId, item.id || null, item.name || "Ürün", qty, price, price * qty]
        );
      }

      // 3) pendingorders'a address + cart kaydet (kargo kodun buradan adres çekiyor)
      await client.query(
        `
        INSERT INTO pendingorders (
          userid, totalprice, cartjson, addressjson, shippingfee,
          createdat, status, updatedat, final_order_id
        )
        VALUES ($1,$2,$3,$4,$5,NOW(),$6,NOW(),$7)
        `,
        [
          userId,
          total,
          JSON.stringify(cart || []),
          JSON.stringify(address || {}),
          ship,
          "transfer_pending",
          orderId,
        ]
      );

      await client.query("COMMIT");

      // istersen mail bildirimi de at (ödeme bekleniyor diye)
      try {
        notifyNewOrder({
          orderId,
          total: total.toFixed(2),
          tracking: null,
          userId,
        });
      } catch {}

      return res.json({ ok: true, orderNo: String(orderId), order: { id: orderId } });
    } catch (e) {
      if (client) {
        try { await client.query("ROLLBACK"); } catch {}
      }
      console.error("transfer/create tx error:", e);
      return res.status(500).json({ ok: false, error: "Sunucu hatası (transfer create)." });
    } finally {
      if (client) client.release();
    }
  } catch (e) {
    console.error("transfer/create error:", e);
    return res.status(500).json({ ok: false, error: "Sunucu hatası." });
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
    const baseKey = String(orderId).padStart(7, "0"); // 7 hane
    const d = new Date();
    const yymmdd =
      String(d.getFullYear()).slice(-2) +
      String(d.getMonth() + 1).padStart(2, "0") +
      String(d.getDate()).padStart(2, "0"); // 6 hane

    let rndNum = Math.floor(Math.random() * 1000);
    try {
      const cryptoMod = await import("crypto");
      const randomInt = cryptoMod.randomInt || cryptoMod.default?.randomInt;
      if (typeof randomInt === "function") rndNum = randomInt(0, 1000);
    } catch (e) {
      // crypto import başarısızsa Math.random ile devam
    }

    const rnd = String(rndNum).padStart(3, "0"); // 3 hane

    const cargoKey = `DT${baseKey}${yymmdd}${rnd}`; // toplam 18
    const invoiceKey = cargoKey;

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

// Admin: Siparişi otomatik kargoya ver (Yurtiçi createShipment)
app.post("/api/admin/orders/:id/ship", requireAdmin, async (req, res) => {
  const orderId = Number(req.params.id);
  if (!orderId) {
    return res.status(400).json({ ok: false, error: "Geçersiz sipariş ID." });
  }

  let client;
  try {
    client = await pgPool.connect();
    await client.query("BEGIN");

    // 1) Siparişi kilitle (aynı anda 2 kere kargoya verme olmasın)
    const orderRes = await client.query(
      `SELECT id, userid, trackingnumber, status
       FROM orders
       WHERE id = $1
       FOR UPDATE`,
      [orderId]
    );

    if (orderRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Sipariş bulunamadı." });
    }

    const order = orderRes.rows[0];

    // Zaten kargoya verildiyse tekrar üretme
    if (order.trackingnumber) {
      await client.query("COMMIT");
      return res.json({
        ok: true,
        message: "Zaten kargoya verilmiş.",
        trackingNumber: order.trackingnumber,
      });
    }

    // 2) Adresi bul: pendingorders üzerinden (final_order_id ile)
    const pendingRes = await client.query(
      `SELECT addressjson
       FROM pendingorders
       WHERE final_order_id = $1
       ORDER BY id DESC
       LIMIT 1`,
      [orderId]
    );

    let address = {};
    if (pendingRes.rows.length > 0) {
      address = JSON.parse(pendingRes.rows[0].addressjson || "{}");
    } else {
      // fallback: useraddresses (shipping)
      const addrRes = await client.query(
        `SELECT *
         FROM useraddresses
         WHERE userid = $1 AND type = 'shipping'
         ORDER BY id DESC
         LIMIT 1`,
        [order.userid]
      );
      address = addrRes.rows[0] || {};
    }

    // 3) Sepeti ürünlerden çıkar: orderitems
    const itemsRes = await client.query(
      `SELECT productid AS id, productname AS name, quantity AS qty, unitprice AS price
       FROM orderitems
       WHERE orderid = $1`,
      [orderId]
    );

    const cart = itemsRes.rows.map((r) => ({
      id: r.id,
      name: r.name,
      qty: Number(r.qty || 1),
      price: Number(r.price || 0),
    }));

    // 4) Kargo için buyer & adres
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
      postalCode: address.zipCode || address.postalcode || "",
    };

    // 5) Yurtiçi createShipment
    const shipmentResult = await createYurticiKargoShipment(
      orderId,
      buyer,
      shippingAddress,
      cart
    );

    if (!shipmentResult?.success) {
      throw new Error("Kargo oluşturulamadı: " + (shipmentResult?.error || ""));
    }

    const trackingNumber = shipmentResult.trackingNumber; // DT000000x

    // 6) orders güncelle: tracking + status
    await client.query(
      `UPDATE orders
       SET trackingnumber = $1,
           status = 'shipped'
       WHERE id = $2`,
      [trackingNumber, orderId]
    );

    await client.query("COMMIT");

    return res.json({ ok: true, trackingNumber });
  } catch (e) {
    console.error("ship auto error:", e);
    if (client) {
      try { await client.query("ROLLBACK"); } catch { }
    }
    return res.status(500).json({ ok: false, error: e.message || "Sunucu hatası" });
  } finally {
    if (client) client.release();
  }
});

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
// Iyzico ödeme callback (PostgreSQL sürümü)
const iyzicoCallbackHandler = (req, res) => {
  const token =
    (req.body && req.body.token) ||
    (req.query && (req.query.token || req.query.checkoutFormToken));
  console.log("💳 Iyzico callback body:", req.body);

  if (!token) {
    console.error("❌ Callback'te token yok");
    return res.redirect(303, "/odeme-hata.html");
  }

  iyzipay.checkoutForm.retrieve(
    { locale: Iyzipay.LOCALE.TR, token },
    async (err, result) => {

      // ✅ tek yerde token belirle
      let iyzToken = token;
      if (result?.token) iyzToken = result.token;

      if (err) {
        console.error("❌ iyzico retrieve error:", err);
        return res.redirect(303, "/odeme-hata.html");
      }

      console.log("✅ Iyzico retrieve result:", result);

      if (result.status !== "success" || result.paymentStatus !== "SUCCESS") {
        console.error("❌ Ödeme başarısız veya iptal:", {
          status: result.status,
          paymentStatus: result.paymentStatus,
          errorMessage: result.errorMessage,
        });
        return res.redirect(303, "/odeme-hata.html");
      }

      let client;
      try {
        client = await pgPool.connect();
        await client.query("BEGIN");

        console.log("📦 Callback token ile pending ara:", iyzToken);

        const pendingRes = await client.query(
          `
          SELECT *
          FROM pendingorders
          WHERE iyzicotoken = $1
          LIMIT 1
          `,
          [iyzToken]
        );

        if (pendingRes.rows.length === 0) {
          throw new Error("PendingOrders kaydı bulunamadı (token eşleşmedi)");
        }

        const pending = pendingRes.rows[0];
        const pendingId = pending.id;

        const cart = JSON.parse(pending.cartjson || "[]");
        const address = JSON.parse(pending.addressjson || "{}");

        const orderInsertRes = await client.query(
          `
        INSERT INTO orders (
          userid, totalprice, paidprice, paymentid, paymentstatus,
          conversationid, basketid, iyzicotoken, currency,
          trackingnumber, createdat, shippingfee, status
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11,$12)
        RETURNING id
        `,
          [
            pending.userid,
            Number(pending.totalprice),
            Number(result.paidPrice),
            String(result.paymentId),
            String(result.paymentStatus),
            String(result.conversationId || ""),
            String(result.basketId || ""),
            String(iyzToken),
            String(result.currency || "TRY"),
            null,                              // trackingnumber
            Number(pending.shippingfee || 0),  // shippingfee
            "preparing",                       // status
          ]
        );

        const orderId = orderInsertRes.rows[0].id;

        for (const item of cart) {
          const qty = item.qty || 1;
          const price = Number(item.price || 0);
          await client.query(
            `
            INSERT INTO orderitems (orderid, productid, productname, quantity, unitprice, totalprice)
            VALUES ($1,$2,$3,$4,$5,$6)
            `,
            [orderId, item.id || null, item.name || "Ürün", qty, price, price * qty]
          );
        }

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

        //const shipmentResult = await createYurticiKargoShipment(orderId, buyer, shippingAddress, cart);
        //if (!shipmentResult?.success) {
        //   throw new Error("Yurtiçi Kargo gönderisi oluşturulamadı: " + (shipmentResult?.error || ""));
        //}
        //const trackingNumber = shipmentResult.trackingNumber;
        //await client.query(
        //  `UPDATE orders SET trackingnumber = $1 WHERE id = $2`,
        //  [trackingNumber || null, orderId]
        // );
        const trackingNumber = null; // kargo henüz oluşturulmadı
        await client.query(
          `
          UPDATE pendingorders
          SET status='completed',
              final_order_id=$1,
              updatedat=NOW(),
              fail_reason=NULL
          WHERE id=$2
          `,
          [orderId, pendingId]
        );
        await client.query("COMMIT");
        // ✅ 1) önce grandTotal tanımla
        const grandTotal = Number(pending.totalprice || result.paidPrice || 0);
        notifyNewOrder({
          orderId,
          total: grandTotal.toFixed(2),
          tracking: trackingNumber,   // null gider → mailde “Henüz yok” yazdırabilirsin
          userId: pending.userid,
        });
        const qs = new URLSearchParams({
          orderId: String(orderId),
          tracking: trackingNumber || "",  // "" olur
          total: grandTotal.toFixed(2),
        }).toString();

        return res.redirect(303, `/odeme-basarili.html?${qs}`);

      } catch (dbErr) {
        console.error("❌ Ödeme sonrası DB/Kargo hatası:", dbErr);

        if (client) {
          try { await client.query("ROLLBACK"); } catch { }
        }

        // ✅ iyzToken burada da aynı değişken
        try {
          await dbQuery(
            `
            UPDATE pendingorders
            SET status='failed',
                fail_reason=$1,
                updatedat=NOW()
            WHERE iyzicotoken=$2
            `,
            [String(dbErr?.message || dbErr), iyzToken]
          );
        } catch (e2) {
          console.error("pendingorders failed update hatası:", e2);
        }

        return res.redirect(303, "/odeme-hata.html");
      } finally {
        if (client) client.release();
      }
    }
  );
};

app.get("/iyzico-callback", iyzicoCallbackHandler);
app.post("/iyzico-callback", iyzicoCallbackHandler);

async function notifyNewOrder({ orderId, total, tracking, userId }) {
  try {
    const to =
      process.env.ORDER_NOTIFY_TO ||
      process.env.JOB_APP_NOTIFY_TO ||
      process.env.SMTP_USER;

    const mailOptions = {
      from: `"DroneTech Sipariş" <${process.env.SMTP_USER}>`,
      to,
      subject: `🛒 Yeni Sipariş Geldi (#${orderId})`,
      text:
        `Yeni bir sipariş oluşturuldu.\n\n` +
        `Sipariş No: ${orderId}\n` +
        `Kullanıcı ID: ${userId}\n` +
        `Toplam Tutar: ${total} TL\n` +
        `Kargo Takip: ${tracking || "-"}\n`,
    };

    const info = await mailTransporter.sendMail(mailOptions);
    console.log("✅ Sipariş maili gönderildi:", info.messageId);
  } catch (err) {
    console.error("❌ Sipariş maili gönderilemedi:", err);
  }
}

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

// Sipariş detaylarını getir (ödeme sonrası sayfada göstermek için) - PostgreSQL
app.get("/api/orders/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res
        .status(400)
        .json({ ok: false, error: "Geçersiz sipariş numarası." });
    }

    // Ana sipariş
    const orderRes = await dbQuery(
      `
      SELECT
        id,
        userid,
        totalprice,
        paidprice,
        trackingnumber,
        createdat
      FROM orders
      WHERE id = $1
      LIMIT 1
      `,
      [id]
    );

    if (orderRes.rows.length === 0) {
      return res
        .status(404)
        .json({ ok: false, error: "Sipariş bulunamadı." });
    }

    const order = orderRes.rows[0];

    // Kalemler
    const itemsRes = await dbQuery(
      `
      SELECT
        productname,
        quantity,
        unitprice,
        totalprice
      FROM orderitems
      WHERE orderid = $1
      `,
      [id]
    );

    return res.json({
      ok: true,
      order,
      items: itemsRes.rows || [],
    });
  } catch (err) {
    console.error("GET /api/orders/:id error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});


/* ---------------- API: Password Update (PostgreSQL) ---------------- */
app.post("/api/account/password", async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const { current_password, new_password, new_password_confirm } = req.body;

  if (!new_password || new_password.length < 8) {
    return res
      .status(400)
      .json({ error: "Yeni şifre en az 8 karakter olmalı." });
  }

  if (new_password !== new_password_confirm) {
    return res.status(400).json({ error: "Yeni şifreler uyuşmuyor." });
  }

  try {
    // Eski şifreyi çek (PostgreSQL)
    const result = await dbQuery(
      `
      SELECT passwordhash
      FROM users
      WHERE id = $1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Kullanıcı bulunamadı." });
    }

    const user = result.rows[0];

    // Mevcut şifre gönderilmişse doğrula
    if (current_password) {
      const ok = await bcrypt.compare(current_password, user.passwordhash);
      if (!ok) {
        return res.status(401).json({ error: "Mevcut şifre hatalı." });
      }
    }

    // Yeni şifreyi hash'le
    const newHash = await bcrypt.hash(new_password, 12);

    // DB'ye yaz (PostgreSQL)
    await dbQuery(
      `
      UPDATE users
      SET passwordhash = $1
      WHERE id = $2
      `,
      [newHash, userId]
    );

    return res.json({ ok: true, message: "Şifre güncellendi." });
  } catch (err) {
    console.error("Password update error:", err);
    res.status(500).json({ error: "Sunucu hatası." });
  }
});
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
    const result = await dbQuery(
      `
      SELECT 
        o.id,
        o.totalprice,
        o.paidprice,
        o.trackingnumber,
        o.createdat,
        o.status,
        COUNT(oi.id) AS itemcount
      FROM orders o
      LEFT JOIN orderitems oi ON oi.orderid = o.id
      WHERE o.userid = $1
      GROUP BY 
        o.id, o.totalprice, o.paidprice, 
        o.trackingnumber, o.createdat, o.status
      ORDER BY o.createdat DESC
      `,
      [userId]
    );

    return res.json({
      ok: true,
      orders: result.rows || [],
    });
  } catch (err) {
    console.error("GET /api/my/orders error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

// Admin: Siparişi kargoya ver (Yurtiçi createShipment çağırır)
app.post("/api/admin/orders/:id/ship", requireAdmin, async (req, res) => {
  const orderId = Number(req.params.id);
  if (!orderId) {
    return res.status(400).json({ ok: false, error: "Geçersiz sipariş ID." });
  }

  let client;
  try {
    client = await pgPool.connect();
    await client.query("BEGIN");

    // 1) Siparişi + adresi bulmak için pendingorders üzerinden addressjson çekiyoruz
    // (senin akışında pendingorders.final_order_id yazılıyor)
    const pendingRes = await client.query(
      `
      SELECT *
      FROM pendingorders
      WHERE final_order_id = $1
      ORDER BY id DESC
      LIMIT 1
      `,
      [orderId]
    );

    if (!pendingRes.rows.length) {
      throw new Error("Bu sipariş için pendingorders bulunamadı (final_order_id eşleşmedi).");
    }

    const pending = pendingRes.rows[0];
    const address = JSON.parse(pending.addressjson || "{}");
    const cart = JSON.parse(pending.cartjson || "[]");

    // 2) Orders kontrol (zaten shipped mi?)
    const orderRes = await client.query(
      `SELECT id, trackingnumber, status FROM orders WHERE id = $1 LIMIT 1`,
      [orderId]
    );
    if (!orderRes.rows.length) {
      throw new Error("Sipariş bulunamadı.");
    }
    const order = orderRes.rows[0];

    if (order.trackingnumber) {
      // zaten kargoya verilmiş
      await client.query("ROLLBACK");
      return res.json({
        ok: true,
        message: "Bu sipariş zaten kargoya verilmiş.",
        trackingNumber: order.trackingnumber,
        status: order.status,
      });
    }

    // 3) Yurtiçi createShipment çağır
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
      throw new Error("Yurtiçi Kargo oluşturulamadı: " + (shipmentResult?.error || ""));
    }

    const trackingNumber = shipmentResult.trackingNumber;

    // 4) Orders tablosunu güncelle: trackingnumber + status=shipped
    await client.query(
      `
      UPDATE orders
      SET trackingnumber = $1,
          status = 'shipped'
      WHERE id = $2
      `,
      [trackingNumber, orderId]
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      trackingNumber,
      status: "shipped",
    });
  } catch (err) {
    if (client) {
      try { await client.query("ROLLBACK"); } catch { }
    }
    console.error("POST /api/admin/orders/:id/ship error:", err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  } finally {
    if (client) client.release();
  }
});

app.get("/api/admin/orders/transfer-pending", requireAdmin, async (_req, res) => {
  try {
    const r = await dbQuery(`
      SELECT id, userid, totalprice, paidprice, paymentstatus, status, createdat
      FROM orders
      WHERE paymentstatus = 'PENDING_TRANSFER'
      ORDER BY createdat DESC
    `);
    res.json({ ok: true, orders: r.rows });
  } catch (e) {
    console.error("transfer-pending error:", e);
    res.status(500).json({ ok: false, error: "Sunucu hatası" });
  }
});

app.post("/api/admin/orders/:id/mark-paid", requireAdmin, async (req, res) => {
  try {
    const orderId = Number(req.params.id);
    if (!orderId) return res.status(400).json({ ok:false, error:"Geçersiz sipariş id" });

    const r = await dbQuery(`
      UPDATE orders
      SET
        paidprice = totalprice,
        paymentstatus = 'SUCCESS'
      WHERE id = $1
      RETURNING id, totalprice, paidprice, paymentstatus, status, createdat
    `, [orderId]);

    if (!r.rows.length) return res.status(404).json({ ok:false, error:"Sipariş bulunamadı" });

    res.json({ ok: true, order: r.rows[0] });
  } catch (e) {
    console.error("mark-paid error:", e);
    res.status(500).json({ ok: false, error: "Sunucu hatası" });
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

// Admin: yeni ürün ekle
app.post("/api/admin/products", requireAdmin, async (req, res) => {
  try {
    const {
      name,
      slug,
      description,
      price,
      stock,
      imageUrl,
      category,
      isActive,
      weight_kg,
    } = req.body || {};

    if (!name || !slug) {
      return res
        .status(400)
        .json({ ok: false, error: "Name ve slug zorunludur." });
    }
    // isActive undefined ise default true kabul edelim (eski davranışa benzer)
    const activeValue =
      typeof isActive === "boolean" ? isActive : true;

    const insert = await dbQuery(
      `
        INSERT INTO products (
          name,
          slug,
          description,
          price,
          stock,
          imageurl,
          category,
          isactive,
          weight_kg,  
          createdat 
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
        RETURNING *
        `,
      [
        name,
        slug,
        description || null,
        Number(price || 0),
        Number(stock || 0),
        imageUrl,
        category,
        activeValue,
        Number(weight_kg || 0),   // ✅ ekle
      ]
    );

    res
      .status(201)
      .json({ ok: true, product: insert.rows[0] });
  } catch (err) {
    console.error("POST /api/admin/products error:", err);
    res
      .status(500)
      .json({ ok: false, error: "Sunucu hatası." });
  }
});

// Admin: ürün güncelle (PostgreSQL)
app.put("/api/admin/products/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res.status(400).json({ ok: false, error: "Geçersiz ürün ID." });
    }

    const {
      name,
      slug,
      description,
      price,
      stock,
      imageUrl,
      category,
      isActive,
      weight_kg,          // ✅ ekle
    } = req.body || {};

    // isActive undefined ise varsayılan true
    const activeValue =
      typeof isActive === "boolean" ? isActive : true;

    // UPDATE + RETURNING *
    const update = await dbQuery(
      `
        UPDATE products
        SET
          name        = $1,
          slug        = $2,
          description = $3,
          price       = $4,
          stock       = $5,
          imageurl    = $6,
          category    = $7,
          isactive    = $8,
          weight_kg   = $9,        -- ✅ ekle
          updatedat   = NOW()
        WHERE id = $10
        RETURNING *
        `,
      [
        name,
        slug,
        description || null,
        Number(price || 0),
        Number(stock || 0),
        imageUrl || null,
        category || null,
        activeValue,
        Number(weight_kg || 0),   // ✅ ekle
        id,
      ]
    );

    if (!update.rows.length) {
      return res.status(404).json({ ok: false, error: "Ürün bulunamadı." });
    }

    res.json({ ok: true, product: update.rows[0] });
  } catch (err) {
    console.error("PUT /api/admin/products/:id error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});


// Admin: ürün sil (PostgreSQL – istersen ileride soft delete'e çevirebiliriz)
app.delete("/api/admin/products/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res
        .status(400)
        .json({ ok: false, error: "Geçersiz ürün ID." });
    }

    const result = await dbQuery(
      `
        DELETE FROM products
        WHERE id = $1
        `,
      [id]
    );

    //İstersen "bulunamadı" kontrolü:
    if (result.rowCount === 0) {
      return res
        .status(404)
        .json({ ok: false, error: "Ürün bulunamadı." });
    }

    return res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/admin/products/:id error:", err);
    return res
      .status(500)
      .json({ ok: false, error: "Sunucu hatası." });
  }
});

// Admin: ürüne teknik görsel yükleme (PostgreSQL)
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

      // 1) productimages tablosuna ekle
      await dbQuery(
        `
        INSERT INTO productimages (productid, imageurl, createdat)
        VALUES ($1, $2, NOW())
        `,
        [productId, url]
      );

      // 2) Eğer ürünün imageurl kolonu boşsa ANA görsel olarak bunu set et
      await dbQuery(
        `
        UPDATE products
        SET imageurl = $1
        WHERE id = $2 AND (imageurl IS NULL OR imageurl = '')
        `,
        [url, productId]
      );

      return res.json({ ok: true, url });
    } catch (err) {
      console.error("POST /api/admin/products/:id/images error:", err);
      res
        .status(500)
        .json({ ok: false, error: "Yükleme sırasında hata." });
    }
  }
);

// Admin: ürüne ait teknik görselleri listele (PostgreSQL)
app.get("/api/admin/products/:id/images", requireAdmin, async (req, res) => {
  try {
    const productId = Number(req.params.id);
    if (!productId) {
      return res
        .status(400)
        .json({ ok: false, error: "Geçersiz ürün ID." });
    }

    const r = await dbQuery(
      `
      SELECT
        id,
        imageurl,
        createdat
      FROM productimages
      WHERE productid = $1
      ORDER BY createdat ASC
      `,
      [productId]
    );

    return res.json({ ok: true, images: r.rows });
  } catch (err) {
    console.error("GET /api/admin/products/:id/images error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});


// Admin: teknik görsel sil (PostgreSQL)
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

      await dbQuery(
        `
        DELETE FROM productimages
        WHERE id = $1 AND productid = $2
        `,
        [imageId, productId]
      );

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
      return res
        .status(400)
        .json({ ok: false, error: "Geçersiz ürün Id." });
    }
    if (!req.file) {
      return res
        .status(400)
        .json({ ok: false, error: "Görsel dosyası gerekli." });
    }

    const caption = String(req.body.caption || "").trim() || null;
    const relPath = "/uploads/products/" + req.file.filename;

    try {
      const r = await dbQuery(
        `
        INSERT INTO productdetailimages
          (productid, imageurl, caption, sortorder, createdat)
        VALUES
          ($1,       $2,       $3,      $4,       NOW())
        RETURNING *
        `,
        [productId, relPath, caption, 0]   // şimdilik sortorder = 0
      );

      return res.json({ ok: true, image: r.rows[0] });
    } catch (err) {
      console.error(
        "POST /api/admin/products/:id/detail-images error:",
        err
      );
      return res
        .status(500)
        .json({ ok: false, error: "Sunucu hatası." });
    }
  }
);

/* ---------------- ADMIN: Ürünün teknik görsellerini listele (PostgreSQL) ---------------- */
app.get(
  "/api/admin/products/:id/detail-images",
  requireAdmin,
  async (req, res) => {
    const productId = parseInt(req.params.id, 10);
    if (!productId) {
      return res
        .status(400)
        .json({ ok: false, error: "Geçersiz ürün Id." });
    }
    try {
      const r = await dbQuery(
        `
        SELECT
          id,
          productid,
          imageurl,
          caption,
          sortorder,
          createdat
        FROM productdetailimages
        WHERE productid = $1
        ORDER BY sortorder ASC, id ASC
        `,
        [productId]
      );

      return res.json({ ok: true, images: r.rows });
    } catch (err) {
      console.error("GET /api/admin/products/:id/detail-images error:", err);
      return res
        .status(500)
        .json({ ok: false, error: "Sunucu hatası." });
    }
  }
);

/* ---------------- ADMIN: Teknik görsel sil (PostgreSQL) ---------------- */
app.delete(
  "/api/admin/products/:id/detail-images/:imageId",
  requireAdmin,
  async (req, res) => {
    const productId = parseInt(req.params.id, 10);
    const imageId = parseInt(req.params.imageId, 10);

    if (!productId || !imageId) {
      return res
        .status(400)
        .json({ ok: false, error: "Geçersiz parametre." });
    }

    try {
      await dbQuery(
        `
        DELETE FROM productdetailimages
        WHERE id = $1 AND productid = $2
        `,
        [imageId, productId]
      );

      return res.json({ ok: true });
    } catch (err) {
      console.error(
        "DELETE /api/admin/products/:id/detail-images/:imageId error:",
        err
      );
      return res
        .status(500)
        .json({ ok: false, error: "Sunucu hatası." });
    }
  }
);

/* ---------------- PUBLIC: Ürünün teknik görselleri (PostgreSQL) ---------------- */
app.get("/api/products/:id/detail-images", async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  if (!productId) {
    return res.status(400).json({ ok: false, error: "Geçersiz ürün Id." });
  }
  try {
    const r = await dbQuery(
      `
      SELECT 
        id, 
        productid, 
        imageurl, 
        caption, 
        sortorder
      FROM productdetailimages
      WHERE productid = $1
      ORDER BY sortorder ASC, id ASC
      `,
      [productId]
    );

    return res.json({ ok: true, images: r.rows });
  } catch (err) {
    console.error("GET /api/products/:id/detail-images error:", err);
    return res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

// Kullanıcı: bir ürünün teknik/ekstra görselleri (PostgreSQL)
app.get("/api/products/:id/images", async (req, res) => {
  try {
    const productId = Number(req.params.id);
    if (!productId) {
      return res
        .status(400)
        .json({ ok: false, error: "Geçersiz ürün ID." });
    }

    const r = await dbQuery(
      `
      SELECT
        id,
        imageurl,
        createdat
      FROM productimages
      WHERE productid = $1
      ORDER BY createdat ASC
      `,
      [productId]
    );

    return res.json({ ok: true, images: r.rows });
  } catch (err) {
    console.error("GET /api/products/:id/images error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

// ================== ADMIN PRODUCTS ==================

// Admin: tüm ürünleri listele (PostgreSQL)
app.get("/api/admin/products", requireAdmin, async (req, res) => {
  try {
    const result = await dbQuery(
      `
      SELECT
        id,
        name,
        slug,
        description,
        price,
        stock,
        imageurl,
        category,
        isactive,
        weight_kg,
        createdat,
        updatedat
      FROM products
      ORDER BY createdat DESC
      `
    );

    res.json({ ok: true, products: result.rows });
  } catch (err) {
    console.error("GET /api/admin/products error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});



// Üyeler listesi (admin - PostgreSQL)
app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const r = await dbQuery(
      `
      SELECT 
        id,
        fullname,
        email
      FROM users
      ORDER BY id DESC
      `
    );

    return res.json({ ok: true, users: r.rows });
  } catch (e) {
    console.error("GET /api/admin/users error:", e?.message || e);
    return res.status(500).json({ ok: false, error: "Sunucu hatası" });
  }
});


// ================== ADMIN ORDERS ==================

// Admin: tüm siparişleri listele (PostgreSQL)
app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  try {
    const result = await dbQuery(
      `
      SELECT
        o.id,
        o.userid,
        o.totalprice,
        o.paidprice,
        o.trackingnumber,
        o.paymentstatus,
        o.status,
        o.createdat,
        COUNT(oi.id) AS itemcount
      FROM orders o
      LEFT JOIN orderitems oi ON oi.orderid = o.id
      GROUP BY
        o.id, o.userid, o.totalprice, o.paidprice,
        o.trackingnumber, o.paymentstatus, o.status, o.createdat
      ORDER BY o.createdat DESC
      `
    );

    res.json({ ok: true, orders: result.rows });
  } catch (err) {
    console.error("GET /api/admin/orders error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

// Admin: tek bir sipariş ve kalemleri (PostgreSQL)
app.get("/api/admin/orders/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res
        .status(400)
        .json({ ok: false, error: "Geçersiz sipariş ID." });
    }

    // Ana siparişi çek
    const orderRes = await dbQuery(
      `
      SELECT
        id,
        userid,
        totalprice,
        paidprice,
        trackingnumber,
        paymentstatus,
        createdat
      FROM orders
      WHERE id = $1
      `,
      [id]
    );

    if (orderRes.rows.length === 0) {
      return res
        .status(404)
        .json({ ok: false, error: "Sipariş bulunamadı." });
    }

    // Kalemleri çek
    const itemsRes = await dbQuery(
      `
      SELECT
        productid,
        productname,
        quantity,
        unitprice,
        totalprice
      FROM orderitems
      WHERE orderid = $1
      `,
      [id]
    );

    res.json({
      ok: true,
      order: orderRes.rows[0],
      items: itemsRes.rows,
    });
  } catch (err) {
    console.error("GET /api/admin/orders/:id error:", err);
    res
      .status(500)
      .json({ ok: false, error: "Sunucu hatası." });
  }
});

// Admin: sipariş durumunu güncelle (ör: shipped, cancelled) - PostgreSQL
app.put("/api/admin/orders/:id/status", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body || {};

    if (!id || !status) {
      return res
        .status(400)
        .json({ ok: false, error: "Geçersiz parametre." });
    }
    // sadece izin verilenler
    const allowed = ["preparing", "shipped", "delivered", "cancelled"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ ok: false, error: "Geçersiz status." });
    }
    const r = await dbQuery(
      `
      UPDATE orders
      SET status = $1,
          updatedat = NOW()
      WHERE id = $2
      RETURNING *
      `,
      [status, id]
    );

    if (r.rows.length === 0) {
      return res
        .status(404)
        .json({ ok: false, error: "Sipariş bulunamadı." });
    }

    res.json({ ok: true, order: r.rows[0] });
  } catch (err) {
    console.error("PUT /api/admin/orders/:id/status error:", err);
    res
      .status(500)
      .json({ ok: false, error: "Sunucu hatası." });
  }
});

// ================== PUBLIC PRODUCTS ==================

// Tüm aktif ürünler (PostgreSQL)
app.get("/api/products", async (req, res) => {
  try {
    const result = await dbQuery(
      `
      SELECT
        id,
        name,
        slug,
        description,
        price,
        stock,
        imageurl,
        category,
        weight_kg
      FROM products
      WHERE isactive = true
      ORDER BY createdat DESC
      `
    );

    res.json({ ok: true, products: result.rows });
  } catch (err) {
    console.error("GET /api/products error:", err);
    res.status(500).json({ ok: false, error: "Sunucu hatası." });
  }
});

// Tek ürün (id ile) - PostgreSQL
app.get("/api/products/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) {
      return res
        .status(400)
        .json({ ok: false, error: "Geçersiz ürün ID." });
    }

    const result = await dbQuery(
      `
      SELECT
        id,
        name,
        slug,
        description,
        price,
        stock,
        imageurl,
        category,
        weight_kg
      FROM products
      WHERE id = $1 AND isactive = true
      `,
      [id]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ ok: false, error: "Ürün bulunamadı." });
    }

    res.json({ ok: true, product: result.rows[0] });
  } catch (err) {
    console.error("GET /api/products/:id error:", err);
    res
      .status(500)
      .json({ ok: false, error: "Sunucu hatası." });
  }
});

app.use((err, req, res, next) => {
  if (err?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      ok: false,
      message: "CV dosyası çok büyük. Maksimum 10 MB yükleyebilirsiniz.",
    });
  }
  next(err);
});

// /admin => admin panel HTML (SPA)
app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
});

/* ---------------- Start ---------------- */
app.listen(PORT, "127.0.0.1", () => {
  console.log(`✅ Server çalışıyor: http://127.0.0.1:${PORT}`);
});