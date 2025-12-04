document.addEventListener("DOMContentLoaded", () => {
    const PENDING_KEY = "pendingApplications";
    const TRACKED_KEY = "appliedJobsLog";
    const STATUS_OPTIONS = [
        { value: "saved", label: "Saved" },
        { value: "applied", label: "Applied" },
        { value: "interview", label: "Interview" },
        { value: "offer", label: "Offer" },
        { value: "rejected", label: "Rejected" }
    ];

    const trackerList = document.getElementById("trackerList");
    const trackerEmpty = document.getElementById("trackerEmpty");
    const pendingQueue = document.getElementById("pendingQueue");
    const pendingSection = document.getElementById("pendingQueueSection");
    const statsNodes = Array.from(document.querySelectorAll("[data-stat]"));
    const form = document.getElementById("trackerForm");
    const formMessage = document.getElementById("trackerFormMessage");

    const readJson = (key) => {
        try {
            return JSON.parse(localStorage.getItem(key) || "[]");
        } catch (err) {
            console.warn("Failed to parse storage for", key, err);
            return [];
        }
    };
    const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));

    const generateId = () => {
        if (window.crypto?.randomUUID) return window.crypto.randomUUID();
        return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    };

    const normalizeEntry = (item) => {
        const loggedAt = item.loggedAt || item.queuedAt || new Date().toISOString();
        const status = item.status || "applied";
        const stageHistory = Array.isArray(item.stageHistory) && item.stageHistory.length
            ? item.stageHistory
            : [{ status, timestamp: loggedAt }];
        return {
            id: item.id || generateId(),
            title: item.title || "Untitled role",
            company: item.company || "Unknown company",
            location: item.location || "",
            link: item.link || "",
            salary: item.salary || "",
            type: item.type || "",
            description: item.description || "",
            status,
            loggedAt,
            nextStepDate: item.nextStepDate || "",
            notes: item.notes || "",
            stageHistory
        };
    };

    const getTrackedJobs = () => readJson(TRACKED_KEY).map(normalizeEntry);
    const saveTrackedJobs = (entries) => writeJson(TRACKED_KEY, entries);
    const getPendingJobs = () => readJson(PENDING_KEY);
    const savePendingJobs = (entries) => writeJson(PENDING_KEY, entries);

    const formatDate = (iso) => {
        if (!iso) return "—";
        try {
            const d = new Date(iso);
            return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
        } catch {
            return iso;
        }
    };

    const renderStats = (jobs) => {
        const totals = { total: jobs.length };
        STATUS_OPTIONS.forEach(({ value }) => { totals[value] = 0; });
        jobs.forEach((job) => {
            totals[job.status] = (totals[job.status] || 0) + 1;
        });
        statsNodes.forEach((node) => {
            const key = node.dataset.stat;
            node.textContent = totals[key] || 0;
        });
    };

    const renderTracked = () => {
        const jobs = getTrackedJobs();
        renderStats(jobs);
        if (!jobs.length) {
            trackerEmpty.style.display = "block";
            trackerList.innerHTML = "";
            return;
        }
        trackerEmpty.style.display = "none";
        trackerList.innerHTML = jobs.map((job) => {
            const historyItems = job.stageHistory
                .slice()
                .reverse()
                .map((entry) => `<li><span>${entry.status}</span> <time>${formatDate(entry.timestamp)}</time></li>`)
                .join("");
            const options = STATUS_OPTIONS.map(({ value, label }) =>
                `<option value="${value}" ${job.status === value ? "selected" : ""}>${label}</option>`
            ).join("");
            return `
                <article class="tracker-item" data-id="${job.id}">
                    <div class="tracker-info">
                        <h3>${job.title}</h3>
                        <p>${job.company}${job.location ? ` · ${job.location}` : ""}</p>
                        <p class="tracker-meta">Logged ${formatDate(job.loggedAt)}</p>
                    </div>
                    <div class="tracker-controls">
                        <label>Status
                            <select class="tracker-status" data-field="status">
                                ${options}
                            </select>
                        </label>
                        <label>Next step
                            <input type="date" value="${job.nextStepDate || ""}" data-field="nextStepDate">
                        </label>
                        <label>Notes
                            <textarea rows="2" data-field="notes" placeholder="Reminders, contacts...">${job.notes || ""}</textarea>
                        </label>
                    </div>
                    <div class="tracker-actions">
                        ${job.link ? `<a href="${job.link}" target="_blank" rel="noopener">Job Link</a>` : ""}
                        <button type="button" class="ghost" data-action="delete">Remove</button>
                        <details>
                            <summary>History</summary>
                            <ul>${historyItems}</ul>
                        </details>
                    </div>
                </article>
            `;
        }).join("");
    };

    const renderPending = () => {
        const queue = getPendingJobs();
        if (!queue.length) {
            pendingSection.style.display = "none";
            return;
        }
        pendingSection.style.display = "block";
        pendingQueue.innerHTML = queue.map((job, index) => `
            <div class="pending-card" data-index="${index}">
                <div>
                    <strong>${job.title}</strong>
                    <p class="muted">${job.company}${job.location ? ` · ${job.location}` : ""}</p>
                </div>
                <div class="pending-actions">
                    <button type="button" data-action="convert">Log it</button>
                    <button type="button" class="ghost" data-action="dismiss">Dismiss</button>
                </div>
            </div>
        `).join("");
    };

    const addJob = (job, status = "saved") => {
        const jobs = getTrackedJobs();
        const entry = normalizeEntry({
            ...job,
            status,
            stageHistory: [
                ...(job.stageHistory || []),
                { status, timestamp: new Date().toISOString() }
            ]
        });
        jobs.unshift(entry);
        saveTrackedJobs(jobs);
        renderTracked();
    };

    trackerList?.addEventListener("input", (event) => {
        const wrapper = event.target.closest(".tracker-item");
        if (!wrapper) return;
        const id = wrapper.dataset.id;
        const field = event.target.dataset.field;
        if (!field) return;
        const jobs = getTrackedJobs();
        const next = jobs.map((job) => {
            if (job.id !== id) return job;
            const updated = { ...job, [field]: event.target.value };
            if (field === "status") {
                updated.stageHistory = [
                    ...(job.stageHistory || []),
                    { status: event.target.value, timestamp: new Date().toISOString() }
                ];
            }
            return updated;
        });
        saveTrackedJobs(next);
        if (field === "status") renderTracked(); // rerender to update history + stats
    });

    trackerList?.addEventListener("click", (event) => {
        const action = event.target.dataset.action;
        if (action !== "delete") return;
        const wrapper = event.target.closest(".tracker-item");
        if (!wrapper) return;
        const id = wrapper.dataset.id;
        const jobs = getTrackedJobs().filter((job) => job.id !== id);
        saveTrackedJobs(jobs);
        renderTracked();
    });

    pendingQueue?.addEventListener("click", (event) => {
        const action = event.target.dataset.action;
        if (!action) return;
        const card = event.target.closest(".pending-card");
        if (!card) return;
        const index = Number(card.dataset.index);
        const queue = getPendingJobs();
        const [job] = queue.splice(index, 1);
        if (action === "convert" && job) {
            addJob(job, "applied");
        }
        savePendingJobs(queue);
        renderPending();
    });

    form?.addEventListener("submit", (event) => {
        event.preventDefault();
        const payload = {
            title: form.jobTitle.value.trim(),
            company: form.jobCompany.value.trim(),
            location: form.jobLocation.value.trim(),
            link: form.jobLink.value.trim(),
            status: form.jobStatus.value,
            nextStepDate: form.jobNextStep.value,
            notes: form.jobNotes.value.trim()
        };
        if (!payload.title) {
            formMessage.textContent = "Title is required.";
            return;
        }
        addJob(payload, payload.status);
        form.reset();
        formMessage.textContent = "Added to tracker.";
        setTimeout(() => (formMessage.textContent = ""), 2500);
    });

    renderPending();
    renderTracked();
});