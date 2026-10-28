(function(window){'use strict';
 const entries=[
  {id:'create-report',name:'Create / Report Project',description:'Create a project or open an existing project to review its current details.',route:'projects/create-report',version:'v1.0',status:'active',icon:'count',theme:'projects',order:1},
  {id:'create-report-case',name:'Create / Report a Case',description:'Create operational assignments, collect reporting, and manage Case outcomes.',route:'cases',version:'v1.0',status:'active',icon:'warehouse',theme:'cases',order:2},
  {id:'operation-news',name:'Operation News',description:'Post and review important operational updates, follow-ups, and attention items.',actions:[{label:'POST NEWS',route:'operation-news/post',primary:true},{label:'OPEN NEWS LIST',route:'operation-news'}],version:'v1.0',status:'active',icon:'count',theme:'news',order:3},
  {id:'overview',name:'Project Overview',route:'projects/overview',status:'coming-soon',hidden:true,order:2},
  {id:'daily-reports',name:'Daily Reports',route:'projects/daily-reports',status:'coming-soon',hidden:true,order:3},
  {id:'closing',name:'Project Closing',route:'projects/closing',status:'coming-soon',hidden:true,order:4},
  {id:'archive',name:'Project Archive / Search',route:'projects/archive',status:'coming-soon',hidden:true,order:5}
 ];
 window.MkiteProjectsRegistry={all:()=>entries.map(entry=>({...entry})).sort((a,b)=>a.order-b.order),get:id=>entries.find(entry=>entry.id===id)};
}(window));
