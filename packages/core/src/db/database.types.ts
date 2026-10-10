
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "ai_agents": {
                  Row: {
                    "auto_reply": boolean,"created_at": string,"human_handoff": boolean,"id": string,"is_active": boolean,"name": string,"objective": string,"organization_id": string,"personality": string,"system_prompt": string,"tone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auto_reply"?: boolean,"created_at"?: string,"human_handoff"?: boolean,"id"?: string,"is_active"?: boolean,"name": string,"objective"?: string,"organization_id": string,"personality"?: string,"system_prompt"?: string,"tone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "auto_reply"?: boolean,"created_at"?: string,"human_handoff"?: boolean,"id"?: string,"is_active"?: boolean,"name"?: string,"objective"?: string,"organization_id"?: string,"personality"?: string,"system_prompt"?: string,"tone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_agents_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: true
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_classifications": {
                  Row: {
                    "conversation_id": string,"created_at": string,"id": string,"intent": string | null,"lead_score": number,"message_id": string,"model": string,"needs_human": boolean,"organization_id": string,"sentiment": Database["public"]['Enums']["sentiment"],"suggested_stage": string | null,"summary": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id": string,"created_at"?: string,"id"?: string,"intent"?: string | null,"lead_score": number,"message_id": string,"model": string,"needs_human": boolean,"organization_id": string,"sentiment": Database["public"]['Enums']["sentiment"],"suggested_stage"?: string | null,"summary"?: string | null
                  }
                  Update: {
                    "conversation_id"?: string,"created_at"?: string,"id"?: string,"intent"?: string | null,"lead_score"?: number,"message_id"?: string,"model"?: string,"needs_human"?: boolean,"organization_id"?: string,"sentiment"?: Database["public"]['Enums']["sentiment"],"suggested_stage"?: string | null,"summary"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_classifications_organization_id_conversation_id_fkey"
      columns: ["organization_id","conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "ai_classifications_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "ai_classifications_organization_id_message_id_fkey"
      columns: ["organization_id","message_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"audit_logs": {
                  Row: {
                    "action": string,"actor_id": string | null,"created_at": string,"entity_id": string | null,"entity_type": string,"id": string,"ip": unknown,"metadata": NonNullable<Json>,"organization_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "action": string,"actor_id"?: string | null,"created_at"?: string,"entity_id"?: string | null,"entity_type": string,"id"?: string,"ip"?: unknown,"metadata"?: NonNullable<Json>,"organization_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"created_at"?: string,"entity_id"?: string | null,"entity_type"?: string,"id"?: string,"ip"?: unknown,"metadata"?: NonNullable<Json>,"organization_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"automation_edges": {
                  Row: {
                    "automation_id": string,"created_at": string,"id": string,"organization_id": string,"source_handle": string,"source_node_id": string,"target_node_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "automation_id": string,"created_at"?: string,"id"?: string,"organization_id": string,"source_handle"?: string,"source_node_id": string,"target_node_id": string
                  }
                  Update: {
                    "automation_id"?: string,"created_at"?: string,"id"?: string,"organization_id"?: string,"source_handle"?: string,"source_node_id"?: string,"target_node_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "automation_edges_organization_id_automation_id_fkey"
      columns: ["organization_id","automation_id"]
isOneToOne: false
      referencedRelation: "automations"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "automation_edges_organization_id_automation_id_source_node_fkey"
      columns: ["organization_id","automation_id","source_node_id"]
isOneToOne: false
      referencedRelation: "automation_nodes"
      referencedColumns: ["organization_id","automation_id","id"]
    },{
      foreignKeyName: "automation_edges_organization_id_automation_id_target_node_fkey"
      columns: ["organization_id","automation_id","target_node_id"]
isOneToOne: false
      referencedRelation: "automation_nodes"
      referencedColumns: ["organization_id","automation_id","id"]
    },{
      foreignKeyName: "automation_edges_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"automation_nodes": {
                  Row: {
                    "automation_id": string,"config": NonNullable<Json>,"created_at": string,"id": string,"organization_id": string,"position": NonNullable<Json>,"type": Database["public"]['Enums']["automation_node_type"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "automation_id": string,"config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"organization_id": string,"position"?: NonNullable<Json>,"type": Database["public"]['Enums']["automation_node_type"],"updated_at"?: string
                  }
                  Update: {
                    "automation_id"?: string,"config"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"organization_id"?: string,"position"?: NonNullable<Json>,"type"?: Database["public"]['Enums']["automation_node_type"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "automation_nodes_organization_id_automation_id_fkey"
      columns: ["organization_id","automation_id"]
isOneToOne: false
      referencedRelation: "automations"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "automation_nodes_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"automation_run_steps": {
                  Row: {
                    "created_at": string,"error": string | null,"id": string,"iteration": number,"node_id": string,"organization_id": string,"output": Json | null,"run_id": string,"status": Database["public"]['Enums']["run_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"error"?: string | null,"id"?: string,"iteration"?: number,"node_id": string,"organization_id": string,"output"?: Json | null,"run_id": string,"status": Database["public"]['Enums']["run_status"]
                  }
                  Update: {
                    "created_at"?: string,"error"?: string | null,"id"?: string,"iteration"?: number,"node_id"?: string,"organization_id"?: string,"output"?: Json | null,"run_id"?: string,"status"?: Database["public"]['Enums']["run_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "automation_run_steps_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "automation_run_steps_organization_id_node_id_fkey"
      columns: ["organization_id","node_id"]
isOneToOne: false
      referencedRelation: "automation_nodes"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "automation_run_steps_organization_id_run_id_fkey"
      columns: ["organization_id","run_id"]
isOneToOne: false
      referencedRelation: "automation_runs"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"automation_runs": {
                  Row: {
                    "automation_id": string,"contact_id": string | null,"conversation_id": string | null,"created_at": string,"current_node_id": string | null,"error": string | null,"id": string,"organization_id": string,"resume_at": string | null,"status": Database["public"]['Enums']["run_status"],"step_count": number,"trigger_event_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "automation_id": string,"contact_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"current_node_id"?: string | null,"error"?: string | null,"id"?: string,"organization_id": string,"resume_at"?: string | null,"status"?: Database["public"]['Enums']["run_status"],"step_count"?: number,"trigger_event_id": string,"updated_at"?: string
                  }
                  Update: {
                    "automation_id"?: string,"contact_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"current_node_id"?: string | null,"error"?: string | null,"id"?: string,"organization_id"?: string,"resume_at"?: string | null,"status"?: Database["public"]['Enums']["run_status"],"step_count"?: number,"trigger_event_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "automation_runs_organization_id_automation_id_current_node_fkey"
      columns: ["organization_id","automation_id","current_node_id"]
isOneToOne: false
      referencedRelation: "automation_nodes"
      referencedColumns: ["organization_id","automation_id","id"]
    },{
      foreignKeyName: "automation_runs_organization_id_automation_id_fkey"
      columns: ["organization_id","automation_id"]
isOneToOne: false
      referencedRelation: "automations"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "automation_runs_organization_id_contact_id_fkey"
      columns: ["organization_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "automation_runs_organization_id_conversation_id_fkey"
      columns: ["organization_id","conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "automation_runs_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "automation_runs_organization_id_trigger_event_id_fkey"
      columns: ["organization_id","trigger_event_id"]
isOneToOne: false
      referencedRelation: "events"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"automations": {
                  Row: {
                    "created_at": string,"created_by": string | null,"created_by_ai": boolean,"description": string | null,"id": string,"name": string,"organization_id": string,"status": Database["public"]['Enums']["automation_status"],"trigger_type": Database["public"]['Enums']["automation_trigger_type"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"created_by_ai"?: boolean,"description"?: string | null,"id"?: string,"name": string,"organization_id": string,"status"?: Database["public"]['Enums']["automation_status"],"trigger_type": Database["public"]['Enums']["automation_trigger_type"],"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"created_by_ai"?: boolean,"description"?: string | null,"id"?: string,"name"?: string,"organization_id"?: string,"status"?: Database["public"]['Enums']["automation_status"],"trigger_type"?: Database["public"]['Enums']["automation_trigger_type"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "automations_organization_id_created_by_fkey"
      columns: ["organization_id","created_by"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["organization_id","user_id"]
    },{
      foreignKeyName: "automations_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"channels": {
                  Row: {
                    "access_token_secret_id": string | null,"app_secret_secret_id": string | null,"created_at": string,"external_account_id": string | null,"id": string,"last_error": string | null,"name": string,"organization_id": string,"status": Database["public"]['Enums']["channel_status"],"type": Database["public"]['Enums']["channel_type"],"updated_at": string,"verify_token_secret_id": string | null,"waba_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "access_token_secret_id"?: string | null,"app_secret_secret_id"?: string | null,"created_at"?: string,"external_account_id"?: string | null,"id"?: string,"last_error"?: string | null,"name": string,"organization_id": string,"status"?: Database["public"]['Enums']["channel_status"],"type": Database["public"]['Enums']["channel_type"],"updated_at"?: string,"verify_token_secret_id"?: string | null,"waba_id"?: string | null
                  }
                  Update: {
                    "access_token_secret_id"?: string | null,"app_secret_secret_id"?: string | null,"created_at"?: string,"external_account_id"?: string | null,"id"?: string,"last_error"?: string | null,"name"?: string,"organization_id"?: string,"status"?: Database["public"]['Enums']["channel_status"],"type"?: Database["public"]['Enums']["channel_type"],"updated_at"?: string,"verify_token_secret_id"?: string | null,"waba_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "channels_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"contact_custom_fields": {
                  Row: {
                    "contact_id": string,"created_at": string,"id": string,"key": string,"organization_id": string,"updated_at": string,"value": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "contact_id": string,"created_at"?: string,"id"?: string,"key": string,"organization_id": string,"updated_at"?: string,"value"?: string | null
                  }
                  Update: {
                    "contact_id"?: string,"created_at"?: string,"id"?: string,"key"?: string,"organization_id"?: string,"updated_at"?: string,"value"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_custom_fields_organization_id_contact_id_fkey"
      columns: ["organization_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "contact_custom_fields_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"contact_tags": {
                  Row: {
                    "contact_id": string,"created_at": string,"id": string,"organization_id": string,"tag_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "contact_id": string,"created_at"?: string,"id"?: string,"organization_id": string,"tag_id": string,"updated_at"?: string
                  }
                  Update: {
                    "contact_id"?: string,"created_at"?: string,"id"?: string,"organization_id"?: string,"tag_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_tags_organization_id_contact_id_fkey"
      columns: ["organization_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "contact_tags_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "contact_tags_organization_id_tag_id_fkey"
      columns: ["organization_id","tag_id"]
isOneToOne: false
      referencedRelation: "tags"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "assigned_to": string | null,"avatar_url": string | null,"created_at": string,"email": string | null,"id": string,"instagram_id": string | null,"last_interaction_at": string | null,"lead_score": number,"name": string | null,"organization_id": string,"phone": string | null,"source": Database["public"]['Enums']["contact_source"],"status": Database["public"]['Enums']["contact_status"],"updated_at": string,"whatsapp_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_to"?: string | null,"avatar_url"?: string | null,"created_at"?: string,"email"?: string | null,"id"?: string,"instagram_id"?: string | null,"last_interaction_at"?: string | null,"lead_score"?: number,"name"?: string | null,"organization_id": string,"phone"?: string | null,"source"?: Database["public"]['Enums']["contact_source"],"status"?: Database["public"]['Enums']["contact_status"],"updated_at"?: string,"whatsapp_id"?: string | null
                  }
                  Update: {
                    "assigned_to"?: string | null,"avatar_url"?: string | null,"created_at"?: string,"email"?: string | null,"id"?: string,"instagram_id"?: string | null,"last_interaction_at"?: string | null,"lead_score"?: number,"name"?: string | null,"organization_id"?: string,"phone"?: string | null,"source"?: Database["public"]['Enums']["contact_source"],"status"?: Database["public"]['Enums']["contact_status"],"updated_at"?: string,"whatsapp_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_organization_id_assigned_to_fkey"
      columns: ["organization_id","assigned_to"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["organization_id","user_id"]
    },{
      foreignKeyName: "contacts_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"conversations": {
                  Row: {
                    "assigned_to": string | null,"channel_id": string,"closed_at": string | null,"contact_id": string,"created_at": string,"handled_by": Database["public"]['Enums']["handler_type"],"id": string,"intent": string | null,"last_message_at": string,"last_read_at": string | null,"organization_id": string,"sentiment": string | null,"status": Database["public"]['Enums']["conversation_status"],"summary": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_to"?: string | null,"channel_id": string,"closed_at"?: string | null,"contact_id": string,"created_at"?: string,"handled_by"?: Database["public"]['Enums']["handler_type"],"id"?: string,"intent"?: string | null,"last_message_at"?: string,"last_read_at"?: string | null,"organization_id": string,"sentiment"?: string | null,"status"?: Database["public"]['Enums']["conversation_status"],"summary"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "assigned_to"?: string | null,"channel_id"?: string,"closed_at"?: string | null,"contact_id"?: string,"created_at"?: string,"handled_by"?: Database["public"]['Enums']["handler_type"],"id"?: string,"intent"?: string | null,"last_message_at"?: string,"last_read_at"?: string | null,"organization_id"?: string,"sentiment"?: string | null,"status"?: Database["public"]['Enums']["conversation_status"],"summary"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversations_organization_id_assigned_to_fkey"
      columns: ["organization_id","assigned_to"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["organization_id","user_id"]
    },{
      foreignKeyName: "conversations_organization_id_channel_id_fkey"
      columns: ["organization_id","channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "conversations_organization_id_contact_id_fkey"
      columns: ["organization_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "conversations_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"deals": {
                  Row: {
                    "contact_id": string,"created_at": string,"currency": string,"id": string,"organization_id": string,"owner_id": string | null,"pipeline_id": string,"stage_id": string,"status": Database["public"]['Enums']["deal_status"],"title": string,"updated_at": string,"value": number
                  }
                  ComputedFields: never
                  Insert: {
                    "contact_id": string,"created_at"?: string,"currency"?: string,"id"?: string,"organization_id": string,"owner_id"?: string | null,"pipeline_id": string,"stage_id": string,"status"?: Database["public"]['Enums']["deal_status"],"title": string,"updated_at"?: string,"value"?: number
                  }
                  Update: {
                    "contact_id"?: string,"created_at"?: string,"currency"?: string,"id"?: string,"organization_id"?: string,"owner_id"?: string | null,"pipeline_id"?: string,"stage_id"?: string,"status"?: Database["public"]['Enums']["deal_status"],"title"?: string,"updated_at"?: string,"value"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "deals_organization_id_contact_id_fkey"
      columns: ["organization_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "deals_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "deals_organization_id_owner_id_fkey"
      columns: ["organization_id","owner_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["organization_id","user_id"]
    },{
      foreignKeyName: "deals_organization_id_pipeline_id_fkey"
      columns: ["organization_id","pipeline_id"]
isOneToOne: false
      referencedRelation: "pipelines"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "deals_organization_id_pipeline_id_stage_id_fkey"
      columns: ["organization_id","pipeline_id","stage_id"]
isOneToOne: false
      referencedRelation: "pipeline_stages"
      referencedColumns: ["organization_id","pipeline_id","id"]
    }
                  ]
                },"events": {
                  Row: {
                    "actor_id": string | null,"actor_type": string,"contact_id": string | null,"conversation_id": string | null,"created_at": string,"deal_id": string | null,"id": string,"organization_id": string,"payload": NonNullable<Json>,"type": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"actor_type": string,"contact_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"deal_id"?: string | null,"id"?: string,"organization_id": string,"payload"?: NonNullable<Json>,"type": string
                  }
                  Update: {
                    "actor_id"?: string | null,"actor_type"?: string,"contact_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"deal_id"?: string | null,"id"?: string,"organization_id"?: string,"payload"?: NonNullable<Json>,"type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "events_organization_id_contact_id_fkey"
      columns: ["organization_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "events_organization_id_conversation_id_fkey"
      columns: ["organization_id","conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "events_organization_id_deal_id_fkey"
      columns: ["organization_id","deal_id"]
isOneToOne: false
      referencedRelation: "deals"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "events_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"knowledge_chunks": {
                  Row: {
                    "chunk_index": number,"content": string,"created_at": string,"document_id": string,"embedding": string,"id": string,"organization_id": string,"token_count": number
                  }
                  ComputedFields: never
                  Insert: {
                    "chunk_index": number,"content": string,"created_at"?: string,"document_id": string,"embedding": string,"id"?: string,"organization_id": string,"token_count"?: number
                  }
                  Update: {
                    "chunk_index"?: number,"content"?: string,"created_at"?: string,"document_id"?: string,"embedding"?: string,"id"?: string,"organization_id"?: string,"token_count"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "knowledge_chunks_organization_id_document_id_fkey"
      columns: ["organization_id","document_id"]
isOneToOne: false
      referencedRelation: "knowledge_documents"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "knowledge_chunks_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"knowledge_documents": {
                  Row: {
                    "content": string,"created_at": string,"error": string | null,"id": string,"organization_id": string,"status": Database["public"]['Enums']["knowledge_status"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content": string,"created_at"?: string,"error"?: string | null,"id"?: string,"organization_id": string,"status"?: Database["public"]['Enums']["knowledge_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "content"?: string,"created_at"?: string,"error"?: string | null,"id"?: string,"organization_id"?: string,"status"?: Database["public"]['Enums']["knowledge_status"],"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "knowledge_documents_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "created_at": string,"id": string,"organization_id": string,"role": Database["public"]['Enums']["org_role"],"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"organization_id": string,"role": Database["public"]['Enums']["org_role"],"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"organization_id"?: string,"role"?: Database["public"]['Enums']["org_role"],"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "memberships_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "channel_id": string,"content": string,"content_type": string,"conversation_id": string,"created_at": string,"direction": Database["public"]['Enums']["message_direction"],"error": string | null,"external_id": string | null,"id": string,"is_internal_note": boolean,"organization_id": string,"sender_type": Database["public"]['Enums']["sender_type"],"sender_user_id": string | null,"status": Database["public"]['Enums']["message_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel_id": string,"content": string,"content_type"?: string,"conversation_id": string,"created_at"?: string,"direction": Database["public"]['Enums']["message_direction"],"error"?: string | null,"external_id"?: string | null,"id"?: string,"is_internal_note"?: boolean,"organization_id": string,"sender_type": Database["public"]['Enums']["sender_type"],"sender_user_id"?: string | null,"status"?: Database["public"]['Enums']["message_status"],"updated_at"?: string
                  }
                  Update: {
                    "channel_id"?: string,"content"?: string,"content_type"?: string,"conversation_id"?: string,"created_at"?: string,"direction"?: Database["public"]['Enums']["message_direction"],"error"?: string | null,"external_id"?: string | null,"id"?: string,"is_internal_note"?: boolean,"organization_id"?: string,"sender_type"?: Database["public"]['Enums']["sender_type"],"sender_user_id"?: string | null,"status"?: Database["public"]['Enums']["message_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_organization_id_channel_id_fkey"
      columns: ["organization_id","channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "messages_organization_id_conversation_id_channel_id_fkey"
      columns: ["organization_id","conversation_id","channel_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["organization_id","id","channel_id"]
    },{
      foreignKeyName: "messages_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "messages_organization_id_sender_user_id_fkey"
      columns: ["organization_id","sender_user_id"]
isOneToOne: false
      referencedRelation: "memberships"
      referencedColumns: ["organization_id","user_id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "company_info": NonNullable<Json>,"created_at": string,"id": string,"name": string,"slug": string,"timezone": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "company_info"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"name": string,"slug": string,"timezone"?: string,"updated_at"?: string
                  }
                  Update: {
                    "company_info"?: NonNullable<Json>,"created_at"?: string,"id"?: string,"name"?: string,"slug"?: string,"timezone"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"pipeline_stages": {
                  Row: {
                    "created_at": string,"id": string,"is_lost": boolean,"is_won": boolean,"name": string,"organization_id": string,"pipeline_id": string,"position": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_lost"?: boolean,"is_won"?: boolean,"name": string,"organization_id": string,"pipeline_id": string,"position": number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_lost"?: boolean,"is_won"?: boolean,"name"?: string,"organization_id"?: string,"pipeline_id"?: string,"position"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pipeline_stages_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "pipeline_stages_organization_id_pipeline_id_fkey"
      columns: ["organization_id","pipeline_id"]
isOneToOne: false
      referencedRelation: "pipelines"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"pipelines": {
                  Row: {
                    "created_at": string,"id": string,"is_default": boolean,"name": string,"organization_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_default"?: boolean,"name": string,"organization_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_default"?: boolean,"name"?: string,"organization_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "pipelines_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "avatar_url": string | null,"created_at": string,"full_name": string | null,"id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "avatar_url"?: string | null,"created_at"?: string,"full_name"?: string | null,"id": string,"updated_at"?: string
                  }
                  Update: {
                    "avatar_url"?: string | null,"created_at"?: string,"full_name"?: string | null,"id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"rate_limits": {
                  Row: {
                    "count": number,"key": string,"window_start": string
                  }
                  ComputedFields: never
                  Insert: {
                    "count"?: number,"key": string,"window_start": string
                  }
                  Update: {
                    "count"?: number,"key"?: string,"window_start"?: string
                  }
                  Relationships: [
                    
                  ]
                },"tags": {
                  Row: {
                    "color": string,"created_at": string,"id": string,"name": string,"organization_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "color"?: string,"created_at"?: string,"id"?: string,"name": string,"organization_id": string,"updated_at"?: string
                  }
                  Update: {
                    "color"?: string,"created_at"?: string,"id"?: string,"name"?: string,"organization_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tags_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "check_rate_limit":
{ Args: { "p_key": string,"p_limit": number,"p_window_seconds": number }; Returns: boolean
                           },
"create_organization_with_owner":
{ Args: { "p_name": string }; Returns: string
                           },
"create_stage":
{ Args: { "p_name": string,"p_pipeline": string }; Returns: string
                           },
"dashboard_metrics":
{ Args: { "p_days": number,"p_org": string }; Returns: Json
                           },
"delete_stage_moving_deals":
{ Args: { "p_stage": string,"p_target_stage": string }; Returns: undefined
                           },
"emit_event":
{ Args: { "p_contact_id": string,"p_conversation_id": string,"p_deal_id": string,"p_org": string,"p_payload"?: Json,"p_type": string }; Returns: undefined
                           },
"has_role":
{ Args: { "p_min": Database["public"]['Enums']["org_role"],"p_org": string }; Returns: boolean
                           },
"ingest_inbound_message":
{ Args: { "p_channel": string,"p_external_id": string,"p_sender_external_id": string,"p_sender_name": string,"p_sent_at": string,"p_text": string }; Returns: string
                           },
"is_member":
{ Args: { "p_org": string }; Returns: boolean
                           },
"is_valid_timezone":
{ Args: { "p": string }; Returns: boolean
                           },
"log_auth_event":
{ Args: { "p_action": string,"p_ip"?: unknown }; Returns: undefined
                           },
"log_conversation_system_message":
{ Args: { "p_conversation": string,"p_kind": string,"p_target_user"?: string }; Returns: undefined
                           },
"mark_conversation_read":
{ Args: { "p_conversation": string }; Returns: undefined
                           },
"reorder_stages":
{ Args: { "p_pipeline": string,"p_stage_ids": (string)[] }; Returns: undefined
                           },
"role_rank":
{ Args: { "r": Database["public"]['Enums']["org_role"] }; Returns: number
                           },
"save_contact":
{ Args: { "p_contact_id": string,"p_custom_fields": Json,"p_data": Json,"p_org": string,"p_tag_ids": (string)[] }; Returns: string
                           },
"search_contacts":
{ Args: { "p_assignee": string,"p_limit": number,"p_offset": number,"p_order": string,"p_org": string,"p_q": string,"p_source": Database["public"]['Enums']["contact_source"],"p_status": Database["public"]['Enums']["contact_status"],"p_tag": string }; Returns: {
              "assigned_to": string,"created_at": string,"email": string,"id": string,"last_interaction_at": string,"lead_score": number,"name": string,"phone": string,"source": Database["public"]['Enums']["contact_source"],"status": Database["public"]['Enums']["contact_status"],"tag_ids": (string)[],"total_count": number
            }[]
                           },
"set_stage_outcome":
{ Args: { "p_outcome": string,"p_stage": string }; Returns: undefined
                           },
"shares_org_with":
{ Args: { "p_user": string }; Returns: boolean
                           },
"slugify":
{ Args: { "p": string }; Returns: string
                           },
"write_audit_log":
{ Args: { "p_action": string,"p_entity_id": string,"p_entity_type": string,"p_ip"?: unknown,"p_metadata"?: Json,"p_org": string }; Returns: undefined
                           }
          }
          Enums: {
            "automation_node_type": "trigger"|"condition"|"message"|"delay"|"tag"|"remove_tag"|"assign_user"|"move_stage"|"ai"|"webhook"|"close_conversation"|"end","automation_status": "draft"|"active"|"paused","automation_trigger_type": "message_received"|"keyword_detected"|"conversation_created"|"tag_added"|"stage_changed"|"contact_created","channel_status": "needs_setup"|"active"|"error","channel_type": "whatsapp"|"instagram"|"simulator","contact_source": "whatsapp"|"instagram"|"manual"|"simulator","contact_status": "lead"|"customer"|"inactive","conversation_status": "open"|"pending_human"|"closed","deal_status": "open"|"won"|"lost","handler_type": "ai"|"human","knowledge_status": "processing"|"ready"|"error","message_direction": "inbound"|"outbound","message_status": "pending"|"sent"|"delivered"|"read"|"failed","org_role": "owner"|"admin"|"agent"|"viewer","run_status": "pending"|"running"|"waiting"|"completed"|"failed"|"cancelled","sender_type": "contact"|"ai"|"human"|"system"|"automation","sentiment": "positive"|"neutral"|"negative"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "automation_node_type": ["trigger", "condition", "message", "delay", "tag", "remove_tag", "assign_user", "move_stage", "ai", "webhook", "close_conversation", "end"],"automation_status": ["draft", "active", "paused"],"automation_trigger_type": ["message_received", "keyword_detected", "conversation_created", "tag_added", "stage_changed", "contact_created"],"channel_status": ["needs_setup", "active", "error"],"channel_type": ["whatsapp", "instagram", "simulator"],"contact_source": ["whatsapp", "instagram", "manual", "simulator"],"contact_status": ["lead", "customer", "inactive"],"conversation_status": ["open", "pending_human", "closed"],"deal_status": ["open", "won", "lost"],"handler_type": ["ai", "human"],"knowledge_status": ["processing", "ready", "error"],"message_direction": ["inbound", "outbound"],"message_status": ["pending", "sent", "delivered", "read", "failed"],"org_role": ["owner", "admin", "agent", "viewer"],"run_status": ["pending", "running", "waiting", "completed", "failed", "cancelled"],"sender_type": ["contact", "ai", "human", "system", "automation"],"sentiment": ["positive", "neutral", "negative"]
          }
        }
} as const
