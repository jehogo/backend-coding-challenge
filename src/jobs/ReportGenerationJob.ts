import { Job } from './Job';
import { Task } from '../models/Task';
import { AppDataSource } from '../data-source';
import { Result } from '../models/Result';
import { TaskStatus } from '../workers/taskRunner';

export class ReportGenerationJob implements Job {
    async run(task: Task): Promise<{ output: string, error: boolean }> {
        console.log(`Running report generation for task ${task.taskId}...`);

        const workflowId = task.workflow.workflowId;
        const taskRepository = AppDataSource.getRepository(Task);
        const resultRepository = AppDataSource.getRepository(Result);

        // Load all tasks in the workflow
        const allTasks = await taskRepository.find({
            where: { workflow: { workflowId: workflowId } },
            relations: ['workflow'],
            order: { stepNumber: 'ASC' }
        });

        // Just get the tasks that are before the current task in the workflow
        const filteredTasks = allTasks.filter(t => t.stepNumber < task.stepNumber);

        // Ensure all preceding tasks are completed before proceeding
        const incompleteTasks = filteredTasks.filter(t => t.status !== TaskStatus.Completed);
        if (incompleteTasks.length > 0) {
            const incompleteTaskIds = incompleteTasks.map(t => `${t.taskId} (step ${t.stepNumber}, status: ${t.status})`).join(', ');
            
            return {
                output: `Cannot generate report: ${incompleteTasks.length} preceding task(s) are not completed. ` +
                `Incomplete tasks: ${incompleteTaskIds}. ` +
                `Report generation requires all preceding tasks to be completed.`,
                error: true
            };
        }

        let countOfTasksErrors = 0;

        // Build the tasks array for the report
        const tasksData = await Promise.all(
            filteredTasks.map(async (t) => {

                const taskOutput = await resultRepository.findOne({
                    where: { resultId: t.resultId }
                });

                if (t.status === TaskStatus.Failed) {
                    countOfTasksErrors++;
                }

                return {
                    taskId: t.taskId,
                    type: t.taskType,
                    error: t.status === TaskStatus.Failed ? taskOutput?.data || '' : null,
                    output: t.status === TaskStatus.Completed ? taskOutput?.data || '' : null,
                };
            })
        );

        // Build the final report
        const report = JSON.stringify({
            workflowId: workflowId,
            tasks: tasksData,
            finalReport: `Tasks completed: ${tasksData.length - countOfTasksErrors}. `+ 
            `Tasks with errors: ${countOfTasksErrors}. `+ 
            `Total tasks: ${tasksData.length}.`
        });

        console.log(`Report generated successfully for workflow ${workflowId}`);
        return {
            output: report,
            error: false
        };
    }
}