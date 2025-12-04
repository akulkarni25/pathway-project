document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("resumeSkillsForm");
  const uploadBtn = document.getElementById("uploadBtn");
  const statusText = document.getElementById("statusText");
  const skillsContainer = document.getElementById("skillsContainer");
  const skillsPills = document.getElementById("skillsPills");
  const resumeDownloadBox = document.getElementById("resumeDownloadBox");
  const resumeDownloadLink = document.getElementById("resumeDownloadLink");

  if (!form) {
    console.error("resumeSkillsForm not found in DOM");
    return;
  }

  function setStatus(msg) {
    statusText.textContent = msg || "";
  }

  function renderSkills(skills) {
    skillsPills.innerHTML = "";

    // Coerce to array in case it's a string
    if (!Array.isArray(skills)) {
      if (typeof skills === "string" && skills.trim()) {
        skills = skills
          .split(/[,;\n]+/)
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        skills = [];
      }
    }

    if (!skills.length) {
      skillsPills.textContent = "No skills were extracted.";
      return;
    }

    skills.forEach((skill) => {
      const span = document.createElement("span");
      span.className = "skill-pill";
      span.textContent = skill;
      skillsPills.appendChild(span);
    });
  }

  async function loadExistingResume() {
    try {
      const res = await fetch("/api/me", {
        credentials: "include",
      });
      const data = await res.json();
      console.log("[resume_upload] /api/me response:", data);

      if (data.success && data.user && data.user.resume_url) {
        resumeDownloadLink.href = data.user.resume_url;
        resumeDownloadBox.style.display = "flex"; // or "block"
      }
    } catch (err) {
      console.error("[resume_upload] Error loading existing resume:", err);
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const fileInput = document.getElementById("resumeFile");
    const file = fileInput.files[0];

    if (!file) {
      setStatus("Please choose a resume file first.");
      return;
    }

    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    const ext = file.name.toLowerCase().split(".").pop();

    if (!allowedTypes.includes(file.type) && !["pdf", "docx"].includes(ext)) {
      setStatus("File must be a PDF or DOCX.");
      return;
    }

    const formData = new FormData();
    formData.append("resume", file);

    uploadBtn.disabled = true;
    setStatus(
      "Uploading and analyzing your resume. This may take a few seconds..."
    );
    skillsContainer.style.display = "none";

    try {
      const res = await fetch("/api/resume_upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const raw = await res.text();
      console.log("[resume_upload] HTTP status:", res.status, "ok:", res.ok);
      console.log("[resume_upload] Raw response text:", raw);

      let data = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch (parseErr) {
        console.error("[resume_upload] JSON parse error:", parseErr);
        setStatus("Server returned invalid JSON.");
        return;
      }

      console.log("[resume_upload] Parsed data:", data);

      if (!res.ok || !data.success) {
        setStatus(
          data.message || "Something went wrong while extracting skills."
        );
        return;
      }

      const skills = data.skills;
      const resumeUrl = data.resumeUrl || data.resume_url;

      setStatus(
        data.message || "Skills extracted and resume saved to your profile."
      );
      renderSkills(skills);
      skillsContainer.style.display = "block";

      if (resumeUrl) {
        resumeDownloadLink.href = resumeUrl;
        resumeDownloadBox.style.display = "flex";
      }
    } catch (err) {
      console.error("[resume_upload] Fetch/network error:", err);
      setStatus(
        "Network error while uploading resume: " +
          (err.message || "Unknown error")
      );
    } finally {
      uploadBtn.disabled = false;
    }
  });

  loadExistingResume();
});
