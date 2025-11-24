import { Repository } from 'typeorm';
import { Task } from '../models/Task';
import { getJobForTaskType } from '../jobs/JobFactory';
import {WorkflowStatus} from "../workflows/WorkflowFactory";
import {Workflow} from "../models/Workflow";
import {Result} from "../models/Result";

export enum TaskStatus {
    Loaded = 'loaded',
    Queued = 'queued',
    InProgress = 'in_progress',
    Completed = 'completed',
    Failed = 'failed',
    Blocked = 'blocked'
}

export class TaskRunner {
    constructor(
        private taskRepository: Repository<Task>,
    ) {}

    
    /**
     * Checks if a cycle is detected in the dependencies of a task.
     * @param task - The task to check for a cycle.
     * @param visitedTasks - The tasks that have been visited to avoid infinite loops.
     * @returns True if a cycle is detected, false otherwise.
     */
    private async checkDependencyCycle(task: Task, visitedTasks: Set<number> = new Set()): Promise<boolean> {
        if (visitedTasks.has(task.stepNumber)) {
            return true;
        }
        visitedTasks.add(task.stepNumber);
        if (task.dependency) {
            const dependencyTask = await this.taskRepository.findOne({ where: { stepNumber: task.dependency.stepNumber }, relations: ['dependency'] });
            if (dependencyTask) {
                return await this.checkDependencyCycle(dependencyTask, visitedTasks);
            }
        }
        return false;
    }

    /**
     * Generates an error result for a task and saves it to the database.
     * @param task - The task entity to generate the error result for.
     * @param reason - The reason for the error.
     */
    private async generateErrorResult(task: Task, reason: string): Promise<void> {
        const resultRepository = this.taskRepository.manager.getRepository(Result);
        const result = new Result();
        result.taskId = task.taskId!;
        result.data = JSON.stringify({output: reason, error: true});
        await resultRepository.save(result);
    }


    /**
     * Runs the appropriate job based on the task's type, managing the task's status.
     * @param task - The task entity that determines which job to run.
     * @throws If the job fails, it rethrows the error.
     */
    async run(task: Task): Promise<void> {
        // Checking dependency and cycle dependecy
        if (task.dependency) {
            const dependencyTask = task.dependency;
            const isCyclic = await this.checkDependencyCycle(task);
            if (isCyclic) {
                console.log(`Cycle dependency detected for task ${task.taskId} [${task.stepNumber}]. Marking task as failed`);
                task.status = TaskStatus.Failed;
                await this.generateErrorResult(task, `Cycle detected in dependency chain of task ${task.taskId}`);
            } else {
                if ([TaskStatus.InProgress, TaskStatus.Queued, TaskStatus.Blocked].includes(dependencyTask.status)) { 
                    console.log(`Task ${task.taskId} [${task.stepNumber}] is blocked because its dependency "${dependencyTask.stepNumber}" is in progress, queued or blocked`);
                    task.status = TaskStatus.Blocked;
                }
                if (dependencyTask.status === TaskStatus.Failed) {
                    console.log(`Task ${task.taskId} [${task.stepNumber}] is failed because its dependency "${dependencyTask.stepNumber}" task failed`);
                    task.status = TaskStatus.Failed;
                    await this.generateErrorResult(task, `This task can not be executed because its dependency "${task.dependency?.stepNumber}" task failed.`);
                }
            }
            await this.taskRepository.save(task);
        }

        if (task.status !== TaskStatus.Blocked && task.status !== TaskStatus.Failed) {
            task.status = TaskStatus.InProgress;
            task.progress = 'starting job...';
            await this.taskRepository.save(task);
            const job = getJobForTaskType(task.taskType);

            try {
                console.log(`Starting job ${task.taskType} for task ${task.taskId}...`);
                const resultRepository = this.taskRepository.manager.getRepository(Result);
                const taskResult = await job.run(task);
                console.log(`Job ${task.taskType} for task ${task.taskId} completed successfully.`);
                const result = new Result();
                result.taskId = task.taskId!;
                result.data = JSON.stringify(taskResult || {});
                await resultRepository.save(result);
                task.resultId = result.resultId!;
                task.status = TaskStatus.Completed;
                task.progress = null;
                await this.taskRepository.save(task); 

            } catch (error: any) {
                console.error(`Error running job ${task.taskType} for task ${task.taskId}:`, error);

                task.status = TaskStatus.Failed;
                task.progress = null;
                await this.taskRepository.save(task);

                throw error;
            }
        }

        const workflowRepository = this.taskRepository.manager.getRepository(Workflow);
        const currentWorkflow = await workflowRepository.findOne({ where: { workflowId: task.workflow.workflowId }, relations: ['tasks'] });

        if (currentWorkflow) {
            currentWorkflow.status = WorkflowStatus.InProgress;
            const allCompleted = currentWorkflow.tasks.every(t => t.status === TaskStatus.Completed);
            const totalTasks = currentWorkflow.tasks.length;
            const totalBlocked = currentWorkflow.tasks.filter(t => t.status === TaskStatus.Blocked).length;
            const totalCompleted = currentWorkflow.tasks.filter(t => t.status === TaskStatus.Completed).length;
            const totalFailed = currentWorkflow.tasks.filter(t => t.status === TaskStatus.Failed).length;

            if (totalTasks === Number(totalCompleted) + Number(totalFailed)) {
                if (allCompleted) {
                    currentWorkflow.status = WorkflowStatus.Completed;
                    currentWorkflow.finalResult = `Workflow finished with ${totalCompleted} task(s) completed.`;
                } else {
                    currentWorkflow.status = WorkflowStatus.Failed;
                    currentWorkflow.finalResult = `Workflow finished with ${totalCompleted} task(s) completed and ${totalFailed} task(s) failed. Errors: `;
                    const resultRepository = this.taskRepository.manager.getRepository(Result);
                    for (const t of currentWorkflow.tasks) {
                        if (t.status === TaskStatus.Failed) {
                            const taskResult = await resultRepository.findOne({ where: { taskId: t.taskId } });
                            if (taskResult) {
                                const taskResultData = JSON.parse(taskResult.data || '{}');
                                currentWorkflow.finalResult += ` Task ${t.taskId} failed with ${taskResultData.output}.`;
                            } 
                        }
                    }
                }
                console.log('');
                console.log(`Workflow ${currentWorkflow.workflowId} fisnished with final result: ${currentWorkflow.finalResult}`);
            }

            // Check if all taks are blocked, to unblock them or mark the workflow as failed
            if (currentWorkflow.status === WorkflowStatus.InProgress && totalBlocked > 0 && (totalBlocked + totalCompleted + totalFailed === totalTasks)) {
                const blockedTasks = currentWorkflow.tasks.filter(t => t.status === TaskStatus.Blocked);
                for (const blockedTask of blockedTasks) {
                    blockedTask.status = TaskStatus.Queued;
                    await this.taskRepository.save(blockedTask);
                }
            }

            await workflowRepository.save(currentWorkflow);
        }

        console.log('');
    }
}