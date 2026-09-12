import cron from "node-cron";
import { TaskStatus } from "@prisma/client";
import { prisma } from "./prisma.js";

export function startOverdueJob() {
  cron.schedule("0 * * * *", async () => {
    try {
      const updated = await prisma.task.updateMany({
        where: { dueDate: { lt: new Date() }, status: { not: TaskStatus.DONE }, isOverdue: false },
        data: { isOverdue: true }
      });
      if (updated.count > 0) console.log(`[scheduler] flagged ${updated.count} overdue tasks`);
    } catch (error) {
      console.error("[scheduler] overdue task update failed", error);
    }
  });
}
