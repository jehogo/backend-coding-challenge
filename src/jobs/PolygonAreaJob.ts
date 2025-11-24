import { Job } from './Job';
import { Task } from '../models/Task';
import area from '@turf/area';
import { Geometry, Polygon, MultiPolygon } from 'geojson';

export class PolygonAreaJob implements Job {
    async run(task: Task): Promise<string> {
        console.log(`Running polygon area calculation for task ${task.taskId}...`);
        try {
            const inputGeometry: Geometry = JSON.parse(task.geoJson);

            if (inputGeometry.type !== 'Polygon' && inputGeometry.type !== 'MultiPolygon') {
                throw new Error(`Invalid geometry type: ${inputGeometry.type}. Expected Polygon or MultiPolygon.`);
            }

            const polygonArea = area(inputGeometry as Polygon | MultiPolygon).toString();
            console.log(`The polygon area is ${polygonArea} square meters`);
            return polygonArea

        } catch (error: any) {
            throw new Error(`Error running polygon area calculation for task ${task.taskId}: ${error.message}`);
        }
    }
}