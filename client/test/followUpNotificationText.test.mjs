import test from "node:test";
import assert from "node:assert/strict";
import { followUpNotificationText, isFollowUpNotification } from "../src/followUpNotificationText.js";

const sample = (stage) => ({
  type: stage > 0 ? "follow_up_pending" : "follow_up_reminder",
  title: "Follow-up reminder", message: "Stored English summary",
  metadata: {
    stage, followUpDate: "2026-09-12", doctorName: "Nitin Somani",
    department: "Neurology", clinicName: "Mishra clinic", roomNumber: "3",
    consultationId: "6aa01785e4603a40c810e040",
  },
});

test("all seven stages have appropriate English and Hindi labels", () => {
  for (const stage of [-3,-2,-1,0,1,2,3]) {
    const english = followUpNotificationText(sample(stage),"en");
    const hindi = followUpNotificationText(sample(stage),"hi");
    assert.match(english.message,/Nitin Somani/);
    assert.match(hindi.message,/Nitin Somani/);
    assert.match(hindi.message,/Mishra clinic/);
    assert.match(hindi.message,/12 सितंबर 2026/);
    assert.match(english.message,/Room 3/);
    if (stage > 0) {
      assert.match(english.title,/pending/i);
      assert.match(hindi.title,/लंबित/);
    } else if (stage < 0) {
      assert.match(english.title,/in \d day/);
    } else {
      assert.equal(english.title,"Follow-up due today");
      assert.match(hindi.title,/आज/);
    }
  }
});

test("actual booked time is displayed without inventing an unbooked appointment", () => {
  const item=sample(-1);
  assert.match(followUpNotificationText(item,"en").message,/No active follow-up appointment/);
  item.metadata.appointmentId="aaaaaaaaaaaaaaaaaaaaaaaa";
  item.metadata.appointmentDate="2026-09-14";
  item.metadata.startTime="10:30";
  assert.match(followUpNotificationText(item,"en").message,/14 September 2026 at 10:30 am/i);
  assert.match(followUpNotificationText(item,"hi").message,/14 सितंबर 2026/);
});

test("existing queue messages and legacy follow-up records remain unchanged", () => {
  const queue={type:"token_called",title:"Your token is being called",message:"Token #23"};
  assert.deepEqual(followUpNotificationText(queue,"hi"),{title:queue.title,message:queue.message});
  const legacy={type:"follow_up_reminder",title:"Follow-up due today",message:"Dr. Nitin",metadata:{}};
  assert.equal(followUpNotificationText(legacy,"hi").message,"Dr. Nitin");
  assert.equal(isFollowUpNotification(queue),false);
  assert.equal(isFollowUpNotification(legacy),true);
});
