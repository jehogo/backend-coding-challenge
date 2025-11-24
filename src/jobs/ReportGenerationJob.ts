import { Job } from './Job';
import { Task } from '../models/Task';
import { AppDataSource } from '../data-source';
import { Result } from '../models/Result';
import { TaskStatus } from '../workers/taskRunner';

interface TaskInfo {
    taskId: string;
    type: string;
    output?: string;
    error?: string;
}

interface Report {
    workflowId: string;
    tasks: TaskInfo[];
    finalReport: string;
}

export class ReportGenerationJob implements Job {

    /**
     * Generates a report for a given workflowID and tasks.
     * @param workflowId - The ID of the workflow.
     * @param tasks - The tasks to generate the report for.
     * @returns The report.
     */
    private async generateReport(workflowId: string, tasks: Task[]): Promise<Report> {
        const resultRepository = AppDataSource.getRepository(Result);
        let countOfTasksErrors = 0;
        // Build the tasks array for the report
        const tasksData = await Promise.all(
            tasks.map(async (t) => {
                const taskOutput = await resultRepository.findOne({
                    where: { resultId: t.resultId }
                });
                if (t.status === TaskStatus.Failed) {
                    countOfTasksErrors++;
                }
                const taskInfo: TaskInfo = {
                    taskId: t.taskId,
                    type: t.taskType,
                }
                if (t.status === TaskStatus.Completed) {
                    taskInfo.output = taskOutput?.data || '';
                } else {
                    taskInfo.error = taskOutput?.data || '';
                }

                return taskInfo;
            })
        );

        // Build the final report
        return  {
            workflowId: workflowId,
            tasks: tasksData,
            finalReport: `Tasks completed: ${tasksData.length - countOfTasksErrors}. `+ 
            `Tasks with errors: ${countOfTasksErrors}. `+ 
            `Total tasks: ${tasksData.length}.`
        };
    }

    async run(task: Task): Promise<Report> {
        console.log(`Running report generation for task ${task.taskId}...`);
        const workflowId = task.workflow.workflowId;
        const taskRepository = AppDataSource.getRepository(Task);
        // Load all tasks in the workflow
        const allTasks = await taskRepository.find({
            where: { workflow: { workflowId: workflowId } },
            relations: ['workflow'],
            order: { stepNumber: 'ASC' }
        });
        // Just get the tasks that are before the current task in the workflow
        const filteredTasks = allTasks.filter(t => t.stepNumber < task.stepNumber);
        // Ensure all preceding tasks are completed before proceeding
        // Supposing that Failed tasks are also a completed task
        const incompleteTasks = filteredTasks.filter(t => ![TaskStatus.Completed, TaskStatus.Failed].includes(t.status));
        if (incompleteTasks.length > 0) {
            const incompleteTaskIds = incompleteTasks.map(t => `${t.taskId} (step ${t.stepNumber}, status: ${t.status})`).join(', ');
            
            throw new Error(`Cannot generate report: ${incompleteTasks.length} preceding task(s) are not completed. ` +
                `Incomplete tasks: ${incompleteTaskIds}. ` +
                `Report generation requires all preceding tasks to be completed.`);
        }
        const report = await this.generateReport(workflowId, filteredTasks);
        console.log(`Report for workflow ${workflowId} generated successfully. \n ${JSON.stringify(report, null, 2)}`);

        return report;
    }
}