import { Repository } from 'typeorm';
import { Task } from '../models/Task';
import { getJobForTaskType } from '../jobs/JobFactory';
import {WorkflowStatus} from "../workflows/WorkflowFactory";
import {Workflow} from "../models/Workflow";
import {Result} from "../models/Result";

export enum TaskStatus {
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
     * @param stepNumber - The step number of the task to check for a cycle.
     * @param visitedTasks - The tasks that have been visited to avoid infinite loops.
     * @returns True if a cycle is detected, false otherwise.
     */
    private async checkDependencyCycle(stepNumber: number, visitedTasks: Set<number> = new Set()): Promise<boolean> {
        if (visitedTasks.has(stepNumber)) {
            return true;
        }
        visitedTasks.add(stepNumber);
        const currentTask = await this.taskRepository.findOne({ where: { stepNumber: stepNumber } });
        if (!currentTask || !currentTask.dependsOn) {
            return false;
        }
        const dependencyTask = await this.taskRepository.findOne({ where: { stepNumber: currentTask.dependsOn } });
        if (dependencyTask) {
            return await this.checkDependencyCycle(dependencyTask.stepNumber!, visitedTasks);
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
        console.log(`Running TASK ${task.taskType} ${task.taskId}... depends on ${task.dependsOn} `);

        if (task.dependsOn) {
            const dependencyTask = await this.taskRepository.findOne({ where: { stepNumber: task.dependsOn } });

            if (!dependencyTask) {
                console.log('No se encontró la tarea dependiente', task.dependsOn); // TODO: delete this log
                task.status = TaskStatus.Failed;
                await this.generateErrorResult(task, `Dependency "${task.dependsOn}" task not found`);
            } else {
                task.dependency = dependencyTask;
                const isCyclic = await this.checkDependencyCycle(task.stepNumber!);
                if (isCyclic) {
                    console.log('CYCLE DETECTED: Dependencia cíclica detectada. Marcar tarea como fallida', task.taskId); // TODO: delete this log
                    task.status = TaskStatus.Failed;
                    await this.generateErrorResult(task, `Cycle detected in dependencies of task ${task.taskId}`);
                } else {
                    if (dependencyTask.status === TaskStatus.InProgress || dependencyTask.status === TaskStatus.Queued || dependencyTask.status === TaskStatus.Blocked) { 
                        console.log('BLOCKED: La tarea dependiente está en progreso, en cola o bloqueada. Bloquear tarea', task.taskId); // TODO: delete this log
                        task.status = TaskStatus.Blocked;
                    }
                    if (dependencyTask.status === TaskStatus.Failed) {
                        console.log('FAILED: La tarea dependiente falló. Marcar tarea como fallida', task.taskId); // TODO: delete this log
                        task.status = TaskStatus.Failed;
                        await this.generateErrorResult(task, `This task can not be executed because its dependency "${task.dependsOn}" task failed.`);
                    }
                }
            }
            await this.taskRepository.save(task);
        }

        console.log('TASK STATUS', task.status);

        if (task.status !== TaskStatus.Blocked && task.status !== TaskStatus.Failed) {
            
            console.log('');

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
            console.log('CURRENT WORKFLOW', currentWorkflow.workflowId); // TODO: delete this log
            const allCompleted = currentWorkflow.tasks.every(t => t.status === TaskStatus.Completed);
            const anyFailed = currentWorkflow.tasks.some(t => t.status === TaskStatus.Failed);
            const totalTasks = currentWorkflow.tasks.length;
            const totalBlocked = currentWorkflow.tasks.filter(t => t.status === TaskStatus.Blocked).length;
            const totalCompleted = currentWorkflow.tasks.filter(t => t.status === TaskStatus.Completed).length;
            const totalFailed = currentWorkflow.tasks.filter(t => t.status === TaskStatus.Failed).length;

            if (anyFailed) {
                currentWorkflow.status = WorkflowStatus.Failed;
            } else if (allCompleted) {
                currentWorkflow.status = WorkflowStatus.Completed;
            } else {
                currentWorkflow.status = WorkflowStatus.InProgress;
            }

            if (totalTasks === Number(totalCompleted) + Number(totalFailed)) {
                if (allCompleted) {
                    currentWorkflow.finalResult = `Workflow finished with ${totalCompleted} task(s) completed.`;
                } else {
                    currentWorkflow.finalResult = `Workflow finished with ${totalCompleted} task(s) completed and ${totalFailed} task(s) failed. `;
                    const resultRepository = this.taskRepository.manager.getRepository(Result);
                    for (const t of currentWorkflow.tasks) {
                        if (t.status === TaskStatus.Failed) {
                            const taskResult = await resultRepository.findOne({ where: { taskId: t.taskId } });
                            if (taskResult) {
                                const taskResultData = JSON.parse(taskResult.data || '{}');
                                currentWorkflow.finalResult += `Task ${t.taskId} failed with ${taskResultData.output}. `;
                            } 
                        }
                    }
                    console.log('currentWorkflow.finalResult', currentWorkflow.finalResult); // TODO: delete this log
                }
                await workflowRepository.save(currentWorkflow); // TODO: check if this is needed
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
    }
}