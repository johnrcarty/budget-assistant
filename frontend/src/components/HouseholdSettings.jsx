import { useState, useEffect } from "react";
import { Plus, Users, Clock3 } from "lucide-react";
import { api } from "../lib/api.js";
import { Button } from "../components/ui.jsx";
export default function HouseholdSettings({
  user,
  onAdd,
  refreshKey,
  localAuth,
}) {
  const [members, setMembers] = useState([]),
    [error, setError] = useState("");
  useEffect(() => {
    api("members")
      .then(setMembers)
      .catch((e) => setError(e.message));
  }, [user, refreshKey]);
  return (
    <section className="card setting-card">
      <div className="setting-icon">
        <Users size={22} />
      </div>
      <p className="eyebrow">BETTER, TOGETHER</p>
      <h2>{user.household_name || "Your household"}</h2>
      <p>
        Every member can see the household budget. Each person has a private
        space for their own finances.
      </p>
      <div className="member-list">
        {members.map((m) => (
          <div key={m.id} className="member-row">
            <span className="avatar">
              {m.display_name?.[0] || m.username[0]}
            </span>
            <div>
              <strong>{m.display_name || m.username}</strong>
              <small>{m.username}</small>
            </div>
            <span className="pill neutral">
              {m.is_admin ? "Admin" : "Member"}
            </span>
          </div>
        ))}
      </div>
      {error && <p className="inline-error">{error}</p>}
      {user.is_admin && localAuth && (
        <Button variant="secondary" icon={Plus} onClick={onAdd}>
          Add household member
        </Button>
      )}
      {!localAuth && (
        <p className="muted small">
          Home Assistant users join this household when they open the ingress
          panel.
        </p>
      )}
      <div className="setting-footnote">
        <Clock3 size={14} />
        {user.timezone || "Household local time"}
      </div>
    </section>
  );
}
