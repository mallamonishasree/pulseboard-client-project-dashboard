import bcrypt from "bcryptjs";
import { ActivityType, NotificationType, Priority, PrismaClient, Role, TaskStatus } from "@prisma/client";

const prisma = new PrismaClient();
const passwordHash = await bcrypt.hash("Pulse123!", 12);

function daysFromNow(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(12, 0, 0, 0);
  return date;
}

async function main() {
  await prisma.notification.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.task.deleteMany();
  await prisma.project.deleteMany();
  await prisma.client.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();

  const admin = await prisma.user.create({ data: { name: "Maya Chen", email: "admin@pulseboard.dev", passwordHash, role: Role.ADMIN } });
  const pmA = await prisma.user.create({ data: { name: "Ravi Nair", email: "ravi@pulseboard.dev", passwordHash, role: Role.PROJECT_MANAGER } });
  const pmB = await prisma.user.create({ data: { name: "Elena Ortiz", email: "elena@pulseboard.dev", passwordHash, role: Role.PROJECT_MANAGER } });
  const [devA, devB, devC, devD] = await Promise.all([
    prisma.user.create({ data: { name: "Jordan Lee", email: "jordan@pulseboard.dev", passwordHash, role: Role.DEVELOPER } }),
    prisma.user.create({ data: { name: "Amara Okafor", email: "amara@pulseboard.dev", passwordHash, role: Role.DEVELOPER } }),
    prisma.user.create({ data: { name: "Theo Martins", email: "theo@pulseboard.dev", passwordHash, role: Role.DEVELOPER } }),
    prisma.user.create({ data: { name: "Nisha Kapoor", email: "nisha@pulseboard.dev", passwordHash, role: Role.DEVELOPER } })
  ]);
  const clientA = await prisma.client.create({ data: { name: "Northstar Health", contact: "ops@northstar.example" } });
  const clientB = await prisma.client.create({ data: { name: "Atlas & Co.", contact: "hello@atlas.example" } });
  const clientC = await prisma.client.create({ data: { name: "Greenline Mobility", contact: "product@greenline.example" } });

  const projectData = [
    { name: "Northstar patient portal", description: "A calm, accessible portal for appointment and care-plan journeys.", clientId: clientA.id, ownerId: pmA.id },
    { name: "Atlas commerce refresh", description: "A new commerce foundation with faster checkout and clearer merchandising.", clientId: clientB.id, ownerId: pmA.id },
    { name: "Greenline fleet console", description: "Operational visibility for charging, routes, and fleet health.", clientId: clientC.id, ownerId: pmB.id }
  ];
  const projects = await Promise.all(projectData.map((data) => prisma.project.create({ data })));
  const developerNames: Record<string, string> = { [devA.id]: devA.name, [devB.id]: devB.name, [devC.id]: devC.name, [devD.id]: devD.name };
  const taskSets = [
    [
      ["Audit keyboard navigation", TaskStatus.IN_REVIEW, Priority.HIGH, devA.id, -2],
      ["Appointment API contract", TaskStatus.DONE, Priority.CRITICAL, devB.id, -8],
      ["Care plan empty states", TaskStatus.IN_PROGRESS, Priority.MEDIUM, devC.id, 3],
      ["Portal analytics events", TaskStatus.TODO, Priority.LOW, devA.id, 7],
      ["Secure session handoff", TaskStatus.IN_PROGRESS, Priority.CRITICAL, devD.id, 1]
    ],
    [
      ["Checkout error recovery", TaskStatus.IN_PROGRESS, Priority.CRITICAL, devB.id, -1],
      ["Product card variants", TaskStatus.DONE, Priority.MEDIUM, devC.id, -4],
      ["Tax calculation edge cases", TaskStatus.TODO, Priority.HIGH, devD.id, 5],
      ["Order confirmation email", TaskStatus.IN_REVIEW, Priority.HIGH, devB.id, 2],
      ["Search result ranking", TaskStatus.TODO, Priority.LOW, devA.id, 12]
    ],
    [
      ["Fleet health dashboard", TaskStatus.IN_PROGRESS, Priority.HIGH, devD.id, 4],
      ["Charging station filters", TaskStatus.TODO, Priority.MEDIUM, devC.id, 9],
      ["Route export CSV", TaskStatus.DONE, Priority.LOW, devA.id, -7],
      ["Alert escalation rules", TaskStatus.IN_REVIEW, Priority.CRITICAL, devD.id, 1],
      ["Driver permissions matrix", TaskStatus.TODO, Priority.HIGH, devC.id, 14]
    ]
  ] as const;

  for (const [projectIndex, project] of projects.entries()) {
    await prisma.activity.create({ data: { projectId: project.id, actorId: projectIndex === 2 ? pmB.id : pmA.id, type: ActivityType.PROJECT_CREATED, message: `${projectIndex === 2 ? "Elena Ortiz" : "Ravi Nair"} created project ${project.name}`, createdAt: daysFromNow(-12) } });
    for (const [index, [title, status, priority, developerId, dueIn]] of taskSets[projectIndex].entries()) {
      const task = await prisma.task.create({ data: { projectId: project.id, title, description: `Seeded delivery item for ${project.name}.`, developerId, status, priority, dueDate: daysFromNow(dueIn), isOverdue: dueIn < 0 && status !== TaskStatus.DONE } });
      const actorId = index % 2 === 0 ? developerId : project.ownerId;
      await prisma.activity.create({ data: { projectId: project.id, taskId: task.id, actorId, type: status === TaskStatus.TODO ? ActivityType.TASK_CREATED : ActivityType.STATUS_CHANGED, fromStatus: status === TaskStatus.TODO ? null : TaskStatus.TODO, toStatus: status === TaskStatus.TODO ? null : status, message: status === TaskStatus.TODO ? `${projectIndex === 2 ? "Elena Ortiz" : "Ravi Nair"} created Task #${task.id}` : `${actorId === developerId ? developerNames[developerId] : projectIndex === 2 ? "Elena Ortiz" : "Ravi Nair"} moved Task #${task.id} from To Do -> ${status.replaceAll("_", " ")}`, createdAt: daysFromNow(-10 + index) } });
    }
  }

  const reviewTask = await prisma.task.findFirst({ where: { projectId: projects[0].id, status: TaskStatus.IN_REVIEW } });
  if (reviewTask) await prisma.notification.create({ data: { userId: pmA.id, type: NotificationType.TASK_IN_REVIEW, title: "Task ready for review", message: `Jordan Lee moved Task #${reviewTask.id} to In Review`, projectId: projects[0].id, taskId: reviewTask.id, createdAt: daysFromNow(-1) } });
  await prisma.notification.create({ data: { userId: devD.id, type: NotificationType.TASK_ASSIGNED, title: "New task assigned", message: "You were assigned Secure session handoff", projectId: projects[0].id, taskId: (await prisma.task.findFirstOrThrow({ where: { title: "Secure session handoff" } })).id, createdAt: daysFromNow(-2) } });
  console.log(`Seeded ${admin.email}, 2 project managers, 4 developers, 3 projects, and 15 tasks.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
