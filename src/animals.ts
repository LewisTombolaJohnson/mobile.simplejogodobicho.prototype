export interface AnimalGroup {
  id: number;
  name: string;
  emoji: string;
  numbers: number[]; // 4 numbers each
}

export const animals: AnimalGroup[] = [
  { id:1, name:'Ostrich', emoji:'🐦', numbers:[1,2,3,4] },
  { id:2, name:'Eagle', emoji:'🦅', numbers:[5,6,7,8] },
  { id:3, name:'Donkey', emoji:'🐴', numbers:[9,10,11,12] },
  { id:4, name:'Butterfly', emoji:'🦋', numbers:[13,14,15,16] },
  { id:5, name:'Dog', emoji:'🐶', numbers:[17,18,19,20] },
  { id:6, name:'Goat', emoji:'🐐', numbers:[21,22,23,24] },
  { id:7, name:'Ram', emoji:'🐏', numbers:[25,26,27,28] },
  { id:8, name:'Camel', emoji:'🐪', numbers:[29,30,31,32] },
  { id:9, name:'Snake', emoji:'🐍', numbers:[33,34,35,36] },
  { id:10, name:'Rabbit', emoji:'🐰', numbers:[37,38,39,40] },
  { id:11, name:'Horse', emoji:'🐎', numbers:[41,42,43,44] },
  { id:12, name:'Elephant', emoji:'🐘', numbers:[45,46,47,48] },
  { id:13, name:'Rooster', emoji:'🐓', numbers:[49,50,51,52] },
  { id:14, name:'Cat', emoji:'🐱', numbers:[53,54,55,56] },
  { id:15, name:'Alligator', emoji:'🐊', numbers:[57,58,59,60] },
  { id:16, name:'Lion', emoji:'🦁', numbers:[61,62,63,64] },
  { id:17, name:'Monkey', emoji:'🐒', numbers:[65,66,67,68] },
  { id:18, name:'Pig', emoji:'🐷', numbers:[69,70,71,72] },
  { id:19, name:'Peacock', emoji:'🦚', numbers:[73,74,75,76] },
  { id:20, name:'Turkey', emoji:'🦃', numbers:[77,78,79,80] },
  { id:21, name:'Bull', emoji:'🐂', numbers:[81,82,83,84] },
  { id:22, name:'Tiger', emoji:'🐯', numbers:[85,86,87,88] },
  { id:23, name:'Bear', emoji:'🐻', numbers:[89,90,91,92] },
  { id:24, name:'Deer', emoji:'🦌', numbers:[93,94,95,96] },
  { id:25, name:'Cow', emoji:'🐄', numbers:[97,98,99,100] }
];
