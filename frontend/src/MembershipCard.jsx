import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { LogoMark } from "./Logo.jsx";
import { shortStudioName } from "./format.js";

export function memberNumber(id, staff = false) {
  return `${staff ? "MA" : "FA"}-${String(id).padStart(6, "0")}`;
}

/**
 * Digital ID card; the QR code holds the number for check-in at the entrance.
 * Members get "FA-…" (Mitgliedskarte), staff get "MA-…" (Mitarbeiterausweis).
 */
export default function MembershipCard({ member, staff = false }) {
  const number = memberNumber(member.id, staff);
  const [qr, setQr] = useState("");

  useEffect(() => {
    QRCode.toDataURL(`FITAKTIV:${number}`, {
      margin: 1,
      width: 200,
      errorCorrectionLevel: "M",
      color: { dark: "#0e0e0e", light: "#f5f5f0" },
    })
      .then(setQr)
      .catch(() => setQr(""));
  }, [number]);

  return (
    <aside className={`member-card ${staff ? "staff" : ""}`} aria-label={staff ? "Mitarbeiterausweis" : "Mitgliedskarte"}>
      <div className="member-card-head">
        <LogoMark size={34} />
        <span>{staff ? "Mitarbeiterausweis" : "Mitgliedskarte"}</span>
      </div>
      <div className="member-card-body">
        <div>
          <strong>{member.name}</strong>
          <span>
            {staff
              ? `${member.role === "admin" ? "Studioleitung" : "Trainer"}, ${shortStudioName(member.home_studio_name || "")}`
              : member.home_studio_name
                ? shortStudioName(member.home_studio_name)
                : "Alle Studios"}
          </span>
          <code>{number}</code>
        </div>
        {qr && <img src={qr} alt={`QR-Code mit Ihrer Mitgliedsnummer ${number}`} width="132" height="132" />}
      </div>
      <small>
        {staff
          ? "Zum Einchecken am Personaleingang und für den Zugang zu den Kursräumen."
          : "Zeigen Sie den Code am Eingang, um einzuchecken."}
      </small>
    </aside>
  );
}
