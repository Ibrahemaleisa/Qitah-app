export type OfferQuote={offerId:string;productId:string;merchantId:string;locationId:string;priceHalalas:number;available:number;shippingHalalas:number;etaDays:number};
export type Selection={items:OfferQuote[];subtotalHalalas:number;shippingHalalas:number;totalHalalas:number;shipmentCount:number;maxEtaDays:number};
export function optimizeCart(productIds:string[],offers:OfferQuote[],strategy:"total"|"shipments"|"fastest"="total"):Selection|null {
 const options=productIds.map(id=>offers.filter(o=>o.productId===id&&o.available>0&&Number.isInteger(o.priceHalalas)&&o.priceHalalas>=0&&Number.isInteger(o.shippingHalalas)&&o.shippingHalalas>=0));
 if(options.some(x=>!x.length))return null;
 let best:Selection|null=null;let checked=0;
 const walk=(index:number,items:OfferQuote[])=>{
 if(++checked>100000)throw Error("Too many offer combinations; narrow candidates");
 if(index===options.length){
 const groups=new Map<string,number>();
 for(const o of items){const key=o.merchantId+":"+o.locationId;groups.set(key,Math.max(groups.get(key)??0,o.shippingHalalas))}
 const subtotalHalalas=items.reduce((a,o)=>a+o.priceHalalas,0),shippingHalalas=[...groups.values()].reduce((a,b)=>a+b,0);
 const current={items:[...items],subtotalHalalas,shippingHalalas,totalHalalas:subtotalHalalas+shippingHalalas,shipmentCount:groups.size,maxEtaDays:Math.max(...items.map(o=>o.etaDays))};
 const score=(x:Selection)=>strategy==="shipments"?[x.shipmentCount,x.totalHalalas,x.maxEtaDays]:strategy==="fastest"?[x.maxEtaDays,x.totalHalalas,x.shipmentCount]:[x.totalHalalas,x.shipmentCount,x.maxEtaDays];
 if(!best||score(current).some((v,i)=>v<score(best!)[i]&&score(current).slice(0,i).every((w,j)=>w===score(best!)[j])))best=current;
 return;
 }
 for(const o of options[index])walk(index+1,[...items,o]);
 };walk(0,[]);return best;
}
export const SUBORDER_TRANSITIONS:Record<string,string[]>={NEW:["ACCEPTED","REJECTED"],ACCEPTED:["PACKING"],PACKING:["READY"],READY:["HANDED_OFF"],HANDED_OFF:["DELIVERED"],DELIVERED:[],REJECTED:[]};
export const SHIPMENT_TRANSITIONS:Record<string,string[]>={DRAFT:["LABEL_CREATED"],LABEL_CREATED:["PICKUP_REQUESTED"],PICKUP_REQUESTED:["PICKED_UP","EXCEPTION"],PICKED_UP:["IN_TRANSIT","EXCEPTION"],IN_TRANSIT:["DELIVERED","EXCEPTION"],EXCEPTION:["PICKUP_REQUESTED","IN_TRANSIT","RETURNING"],DELIVERED:["RETURNING"],RETURNING:["RETURNED"],RETURNED:[]};
export function assertTransition(map:Record<string,string[]>,from:string,to:string){if(!map[from]?.includes(to))throw Error(`Invalid transition: ${from} -> ${to}`)}
