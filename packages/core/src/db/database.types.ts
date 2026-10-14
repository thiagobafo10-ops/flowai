
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
      foreignKeyName: "ai_classifications_message_conversation_fk"
      columns: ["organization_id","conversation_id","message_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["organization_id","conversation_id","id"]
    },{
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
                },"ai_jobs": {
                  Row: {
                    "attempts": number,"claim_token": string | null,"claimed_until": string | null,"conversation_id": string | null,"created_at": string,"document_generation": number | null,"document_id": string | null,"id": string,"kind": string,"last_error": string | null,"organization_id": string,"run_after": string,"state": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"claim_token"?: string | null,"claimed_until"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"document_generation"?: number | null,"document_id"?: string | null,"id"?: string,"kind": string,"last_error"?: string | null,"organization_id": string,"run_after"?: string,"state"?: string,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"claim_token"?: string | null,"claimed_until"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"document_generation"?: number | null,"document_id"?: string | null,"id"?: string,"kind"?: string,"last_error"?: string | null,"organization_id"?: string,"run_after"?: string,"state"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_jobs_organization_id_conversation_id_fkey"
      columns: ["organization_id","conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "ai_jobs_organization_id_document_id_fkey"
      columns: ["organization_id","document_id"]
isOneToOne: false
      referencedRelation: "knowledge_documents"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "ai_jobs_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"ai_usage_daily": {
                  Row: {
                    "day": string,"organization_id": string,"replies": number,"tests": number
                  }
                  ComputedFields: never
                  Insert: {
                    "day": string,"organization_id": string,"replies"?: number,"tests"?: number
                  }
                  Update: {
                    "day"?: string,"organization_id"?: string,"replies"?: number,"tests"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_usage_daily_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
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
                    "created_at": string,"error": string | null,"handle": string | null,"id": string,"iteration": number,"node_id": string,"organization_id": string,"output": Json | null,"run_id": string,"status": Database["public"]['Enums']["run_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"error"?: string | null,"handle"?: string | null,"id"?: string,"iteration"?: number,"node_id": string,"organization_id": string,"output"?: Json | null,"run_id": string,"status": Database["public"]['Enums']["run_status"]
                  }
                  Update: {
                    "created_at"?: string,"error"?: string | null,"handle"?: string | null,"id"?: string,"iteration"?: number,"node_id"?: string,"organization_id"?: string,"output"?: Json | null,"run_id"?: string,"status"?: Database["public"]['Enums']["run_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "automation_run_steps_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
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
                    "attempts": number,"automation_id": string,"claim_token": string | null,"claimed_until": string | null,"contact_id": string | null,"conversation_id": string | null,"created_at": string,"current_node_id": string | null,"error": string | null,"id": string,"input": Json | null,"iteration": number,"organization_id": string,"resume_at": string | null,"status": Database["public"]['Enums']["run_status"],"step_count": number,"trigger_event_id": string,"updated_at": string,"version": number | null,"wait_node_id": string | null,"waiting_for": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"automation_id": string,"claim_token"?: string | null,"claimed_until"?: string | null,"contact_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"current_node_id"?: string | null,"error"?: string | null,"id"?: string,"input"?: Json | null,"iteration"?: number,"organization_id": string,"resume_at"?: string | null,"status"?: Database["public"]['Enums']["run_status"],"step_count"?: number,"trigger_event_id": string,"updated_at"?: string,"version"?: number | null,"wait_node_id"?: string | null,"waiting_for"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"automation_id"?: string,"claim_token"?: string | null,"claimed_until"?: string | null,"contact_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"current_node_id"?: string | null,"error"?: string | null,"id"?: string,"input"?: Json | null,"iteration"?: number,"organization_id"?: string,"resume_at"?: string | null,"status"?: Database["public"]['Enums']["run_status"],"step_count"?: number,"trigger_event_id"?: string,"updated_at"?: string,"version"?: number | null,"wait_node_id"?: string | null,"waiting_for"?: string | null
                  }
                  Relationships: [
                    {
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
    },{
      foreignKeyName: "automation_runs_version_fk"
      columns: ["automation_id","version"]
isOneToOne: false
      referencedRelation: "automation_versions"
      referencedColumns: ["automation_id","version"]
    }
                  ]
                },"automation_versions": {
                  Row: {
                    "automation_id": string,"created_at": string,"graph": NonNullable<Json>,"organization_id": string,"trigger_config": NonNullable<Json>,"trigger_type": Database["public"]['Enums']["automation_trigger_type"],"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "automation_id": string,"created_at"?: string,"graph": NonNullable<Json>,"organization_id": string,"trigger_config"?: NonNullable<Json>,"trigger_type": Database["public"]['Enums']["automation_trigger_type"],"version": number
                  }
                  Update: {
                    "automation_id"?: string,"created_at"?: string,"graph"?: NonNullable<Json>,"organization_id"?: string,"trigger_config"?: NonNullable<Json>,"trigger_type"?: Database["public"]['Enums']["automation_trigger_type"],"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "automation_versions_organization_id_automation_id_fkey"
      columns: ["organization_id","automation_id"]
isOneToOne: false
      referencedRelation: "automations"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "automation_versions_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"automations": {
                  Row: {
                    "activated_at": string | null,"created_at": string,"created_by": string | null,"created_by_ai": boolean,"current_version": number,"description": string | null,"id": string,"name": string,"organization_id": string,"status": Database["public"]['Enums']["automation_status"],"trigger_config": NonNullable<Json>,"trigger_type": Database["public"]['Enums']["automation_trigger_type"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "activated_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"created_by_ai"?: boolean,"current_version"?: number,"description"?: string | null,"id"?: string,"name": string,"organization_id": string,"status"?: Database["public"]['Enums']["automation_status"],"trigger_config"?: NonNullable<Json>,"trigger_type": Database["public"]['Enums']["automation_trigger_type"],"updated_at"?: string
                  }
                  Update: {
                    "activated_at"?: string | null,"created_at"?: string,"created_by"?: string | null,"created_by_ai"?: boolean,"current_version"?: number,"description"?: string | null,"id"?: string,"name"?: string,"organization_id"?: string,"status"?: Database["public"]['Enums']["automation_status"],"trigger_config"?: NonNullable<Json>,"trigger_type"?: Database["public"]['Enums']["automation_trigger_type"],"updated_at"?: string
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
                },"campaigns": {
                  Row: {
                    "audience": NonNullable<Json>,"counters": NonNullable<Json>,"created_at": string,"finished_at": string | null,"id": string,"message": NonNullable<Json>,"name": string,"organization_id": string,"scheduled_at": string | null,"started_at": string | null,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "audience"?: NonNullable<Json>,"counters"?: NonNullable<Json>,"created_at"?: string,"finished_at"?: string | null,"id"?: string,"message"?: NonNullable<Json>,"name": string,"organization_id": string,"scheduled_at"?: string | null,"started_at"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "audience"?: NonNullable<Json>,"counters"?: NonNullable<Json>,"created_at"?: string,"finished_at"?: string | null,"id"?: string,"message"?: NonNullable<Json>,"name"?: string,"organization_id"?: string,"scheduled_at"?: string | null,"started_at"?: string | null,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "campaigns_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"channels": {
                  Row: {
                    "access_token_secret_id": string | null,"app_secret_secret_id": string | null,"created_at": string,"external_account_id": string | null,"id": string,"instagram_claimed": boolean,"instagram_username": string | null,"last_error": string | null,"meta_connection_id": string | null,"name": string,"organization_id": string,"status": Database["public"]['Enums']["channel_status"],"type": Database["public"]['Enums']["channel_type"],"updated_at": string,"verify_token_secret_id": string | null,"waba_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "access_token_secret_id"?: string | null,"app_secret_secret_id"?: string | null,"created_at"?: string,"external_account_id"?: string | null,"id"?: string,"instagram_claimed"?: boolean,"instagram_username"?: string | null,"last_error"?: string | null,"meta_connection_id"?: string | null,"name": string,"organization_id": string,"status"?: Database["public"]['Enums']["channel_status"],"type": Database["public"]['Enums']["channel_type"],"updated_at"?: string,"verify_token_secret_id"?: string | null,"waba_id"?: string | null
                  }
                  Update: {
                    "access_token_secret_id"?: string | null,"app_secret_secret_id"?: string | null,"created_at"?: string,"external_account_id"?: string | null,"id"?: string,"instagram_claimed"?: boolean,"instagram_username"?: string | null,"last_error"?: string | null,"meta_connection_id"?: string | null,"name"?: string,"organization_id"?: string,"status"?: Database["public"]['Enums']["channel_status"],"type"?: Database["public"]['Enums']["channel_type"],"updated_at"?: string,"verify_token_secret_id"?: string | null,"waba_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "channels_meta_connection_fk"
      columns: ["organization_id","meta_connection_id"]
isOneToOne: false
      referencedRelation: "meta_connections"
      referencedColumns: ["organization_id","id"]
    },{
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
                    "assigned_to": string | null,"automation_run_id": string | null,"channel_id": string,"closed_at": string | null,"contact_id": string,"created_at": string,"handled_by": Database["public"]['Enums']["handler_type"],"handoff_reason": string | null,"id": string,"intent": string | null,"last_message_at": string,"last_read_at": string | null,"organization_id": string,"sentiment": string | null,"status": Database["public"]['Enums']["conversation_status"],"summary": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "assigned_to"?: string | null,"automation_run_id"?: string | null,"channel_id": string,"closed_at"?: string | null,"contact_id": string,"created_at"?: string,"handled_by"?: Database["public"]['Enums']["handler_type"],"handoff_reason"?: string | null,"id"?: string,"intent"?: string | null,"last_message_at"?: string,"last_read_at"?: string | null,"organization_id": string,"sentiment"?: string | null,"status"?: Database["public"]['Enums']["conversation_status"],"summary"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "assigned_to"?: string | null,"automation_run_id"?: string | null,"channel_id"?: string,"closed_at"?: string | null,"contact_id"?: string,"created_at"?: string,"handled_by"?: Database["public"]['Enums']["handler_type"],"handoff_reason"?: string | null,"id"?: string,"intent"?: string | null,"last_message_at"?: string,"last_read_at"?: string | null,"organization_id"?: string,"sentiment"?: string | null,"status"?: Database["public"]['Enums']["conversation_status"],"summary"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversations_automation_run_fk"
      columns: ["organization_id","automation_run_id"]
isOneToOne: false
      referencedRelation: "automation_runs"
      referencedColumns: ["organization_id","id"]
    },{
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
                },"entry_link_hits": {
                  Row: {
                    "contact_id": string | null,"conversation_id": string | null,"created_at": string,"external_id": string,"id": string,"link_id": string,"organization_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "contact_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"external_id": string,"id"?: string,"link_id": string,"organization_id": string
                  }
                  Update: {
                    "contact_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"external_id"?: string,"id"?: string,"link_id"?: string,"organization_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "entry_link_hits_organization_id_contact_id_fkey"
      columns: ["organization_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "entry_link_hits_organization_id_conversation_id_fkey"
      columns: ["organization_id","conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "entry_link_hits_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entry_link_hits_organization_id_link_id_fkey"
      columns: ["organization_id","link_id"]
isOneToOne: false
      referencedRelation: "entry_links"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"entry_links": {
                  Row: {
                    "channel_id": string,"code": string,"created_at": string,"id": string,"name": string,"organization_id": string,"status": string,"tag_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "channel_id": string,"code": string,"created_at"?: string,"id"?: string,"name": string,"organization_id": string,"status"?: string,"tag_id"?: string | null
                  }
                  Update: {
                    "channel_id"?: string,"code"?: string,"created_at"?: string,"id"?: string,"name"?: string,"organization_id"?: string,"status"?: string,"tag_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "entry_links_organization_id_channel_id_fkey"
      columns: ["organization_id","channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "entry_links_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "entry_links_organization_id_tag_id_fkey"
      columns: ["organization_id","tag_id"]
isOneToOne: false
      referencedRelation: "tags"
      referencedColumns: ["organization_id","id"]
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
                },"instagram_comment_rules": {
                  Row: {
                    "active": boolean,"channel_id": string,"created_at": string,"id": string,"keyword": string,"media_id": string | null,"organization_id": string,"reply_text": string,"updated_at": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"channel_id": string,"created_at"?: string,"id"?: string,"keyword": string,"media_id"?: string | null,"organization_id": string,"reply_text": string,"updated_at"?: string,"version"?: number
                  }
                  Update: {
                    "active"?: boolean,"channel_id"?: string,"created_at"?: string,"id"?: string,"keyword"?: string,"media_id"?: string | null,"organization_id"?: string,"reply_text"?: string,"updated_at"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "instagram_comment_rules_organization_id_channel_id_fkey"
      columns: ["organization_id","channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "instagram_comment_rules_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"instagram_events": {
                  Row: {
                    "attempts": number,"automation_activated_at": string | null,"automation_id": string | null,"automation_run_id": string | null,"automation_version": number | null,"channel_id": string,"created_at": string,"external_id": string,"id": string,"kind": string,"last_error": string | null,"message_id": string | null,"occurred_at": string,"organization_id": string,"payload": NonNullable<Json>,"rule_id": string | null,"rule_version": number | null,"state": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"automation_activated_at"?: string | null,"automation_id"?: string | null,"automation_run_id"?: string | null,"automation_version"?: number | null,"channel_id": string,"created_at"?: string,"external_id": string,"id"?: string,"kind": string,"last_error"?: string | null,"message_id"?: string | null,"occurred_at": string,"organization_id": string,"payload": NonNullable<Json>,"rule_id"?: string | null,"rule_version"?: number | null,"state"?: string
                  }
                  Update: {
                    "attempts"?: number,"automation_activated_at"?: string | null,"automation_id"?: string | null,"automation_run_id"?: string | null,"automation_version"?: number | null,"channel_id"?: string,"created_at"?: string,"external_id"?: string,"id"?: string,"kind"?: string,"last_error"?: string | null,"message_id"?: string | null,"occurred_at"?: string,"organization_id"?: string,"payload"?: NonNullable<Json>,"rule_id"?: string | null,"rule_version"?: number | null,"state"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "instagram_events_automation_fk"
      columns: ["organization_id","automation_id"]
isOneToOne: false
      referencedRelation: "automations"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "instagram_events_organization_id_channel_id_fkey"
      columns: ["organization_id","channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "instagram_events_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "instagram_events_organization_id_rule_id_fkey"
      columns: ["organization_id","rule_id"]
isOneToOne: false
      referencedRelation: "instagram_comment_rules"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"instagram_send_intents": {
                  Row: {
                    "actor_id": string | null,"automation_run_id": string | null,"channel_id": string,"claim_token": string | null,"claimed_at": string | null,"comment_id": string | null,"conversation_id": string | null,"created_at": string,"error_code": string | null,"event_id": string | null,"external_id": string | null,"id": string,"kind": string,"message_id": string | null,"message_payload": Json | null,"organization_id": string,"pending_since": string,"recipient_external_id": string | null,"request_id": string | null,"state": string,"text": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"automation_run_id"?: string | null,"channel_id": string,"claim_token"?: string | null,"claimed_at"?: string | null,"comment_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"error_code"?: string | null,"event_id"?: string | null,"external_id"?: string | null,"id"?: string,"kind"?: string,"message_id"?: string | null,"message_payload"?: Json | null,"organization_id": string,"pending_since"?: string,"recipient_external_id"?: string | null,"request_id"?: string | null,"state"?: string,"text": string
                  }
                  Update: {
                    "actor_id"?: string | null,"automation_run_id"?: string | null,"channel_id"?: string,"claim_token"?: string | null,"claimed_at"?: string | null,"comment_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"error_code"?: string | null,"event_id"?: string | null,"external_id"?: string | null,"id"?: string,"kind"?: string,"message_id"?: string | null,"message_payload"?: Json | null,"organization_id"?: string,"pending_since"?: string,"recipient_external_id"?: string | null,"request_id"?: string | null,"state"?: string,"text"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "instagram_intents_automation_run_fk"
      columns: ["organization_id","automation_run_id"]
isOneToOne: false
      referencedRelation: "automation_runs"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "instagram_intents_conversation_fk"
      columns: ["organization_id","conversation_id","channel_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["organization_id","id","channel_id"]
    },{
      foreignKeyName: "instagram_send_intents_event_id_fkey"
      columns: ["event_id"]
isOneToOne: true
      referencedRelation: "instagram_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "instagram_send_intents_organization_id_channel_id_fkey"
      columns: ["organization_id","channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "instagram_send_intents_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"instagram_verified_media": {
                  Row: {
                    "channel_id": string,"credential_generation": number,"media_id": string,"organization_id": string,"verified_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel_id": string,"credential_generation": number,"media_id": string,"organization_id": string,"verified_at"?: string
                  }
                  Update: {
                    "channel_id"?: string,"credential_generation"?: number,"media_id"?: string,"organization_id"?: string,"verified_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "instagram_verified_media_organization_id_channel_id_fkey"
      columns: ["organization_id","channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "instagram_verified_media_organization_id_fkey"
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
                    "chunk_count": number,"content": string,"created_at": string,"error": string | null,"generation": number,"id": string,"organization_id": string,"status": Database["public"]['Enums']["knowledge_status"],"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "chunk_count"?: number,"content": string,"created_at"?: string,"error"?: string | null,"generation"?: number,"id"?: string,"organization_id": string,"status"?: Database["public"]['Enums']["knowledge_status"],"title": string,"updated_at"?: string
                  }
                  Update: {
                    "chunk_count"?: number,"content"?: string,"created_at"?: string,"error"?: string | null,"generation"?: number,"id"?: string,"organization_id"?: string,"status"?: Database["public"]['Enums']["knowledge_status"],"title"?: string,"updated_at"?: string
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
                    "ai_metadata": Json | null,"channel_id": string,"content": string,"content_type": string,"context": NonNullable<Json>,"conversation_id": string,"created_at": string,"direction": Database["public"]['Enums']["message_direction"],"error": string | null,"external_id": string | null,"id": string,"is_internal_note": boolean,"organization_id": string,"sender_type": Database["public"]['Enums']["sender_type"],"sender_user_id": string | null,"status": Database["public"]['Enums']["message_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "ai_metadata"?: Json | null,"channel_id": string,"content": string,"content_type"?: string,"context"?: NonNullable<Json>,"conversation_id": string,"created_at"?: string,"direction": Database["public"]['Enums']["message_direction"],"error"?: string | null,"external_id"?: string | null,"id"?: string,"is_internal_note"?: boolean,"organization_id": string,"sender_type": Database["public"]['Enums']["sender_type"],"sender_user_id"?: string | null,"status"?: Database["public"]['Enums']["message_status"],"updated_at"?: string
                  }
                  Update: {
                    "ai_metadata"?: Json | null,"channel_id"?: string,"content"?: string,"content_type"?: string,"context"?: NonNullable<Json>,"conversation_id"?: string,"created_at"?: string,"direction"?: Database["public"]['Enums']["message_direction"],"error"?: string | null,"external_id"?: string | null,"id"?: string,"is_internal_note"?: boolean,"organization_id"?: string,"sender_type"?: Database["public"]['Enums']["sender_type"],"sender_user_id"?: string | null,"status"?: Database["public"]['Enums']["message_status"],"updated_at"?: string
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
                },"meta_connections": {
                  Row: {
                    "api_version": string,"app_id": string,"app_secret_id": string | null,"created_at": string,"credential_generation": number,"disconnected_at": string | null,"id": string,"last_error": string | null,"organization_id": string,"owner_verified_at": string | null,"token_verified_at": string | null,"updated_at": string,"verify_token_secret_id": string | null,"webhook_verified_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "api_version": string,"app_id": string,"app_secret_id"?: string | null,"created_at"?: string,"credential_generation"?: number,"disconnected_at"?: string | null,"id"?: string,"last_error"?: string | null,"organization_id": string,"owner_verified_at"?: string | null,"token_verified_at"?: string | null,"updated_at"?: string,"verify_token_secret_id"?: string | null,"webhook_verified_at"?: string | null
                  }
                  Update: {
                    "api_version"?: string,"app_id"?: string,"app_secret_id"?: string | null,"created_at"?: string,"credential_generation"?: number,"disconnected_at"?: string | null,"id"?: string,"last_error"?: string | null,"organization_id"?: string,"owner_verified_at"?: string | null,"token_verified_at"?: string | null,"updated_at"?: string,"verify_token_secret_id"?: string | null,"webhook_verified_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "meta_connections_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
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
                },"outreach_deliveries": {
                  Row: {
                    "attempts": number,"campaign_id": string | null,"channel_id": string,"claim_token": string | null,"claimed_until": string | null,"contact_id": string | null,"conversation_id": string | null,"created_at": string,"enrollment_id": string | null,"id": string,"intent_id": string | null,"message_id": string | null,"organization_id": string,"postponements": number,"reason": string | null,"run_after": string,"source": string,"status": string,"step_id": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"campaign_id"?: string | null,"channel_id": string,"claim_token"?: string | null,"claimed_until"?: string | null,"contact_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"enrollment_id"?: string | null,"id"?: string,"intent_id"?: string | null,"message_id"?: string | null,"organization_id": string,"postponements"?: number,"reason"?: string | null,"run_after"?: string,"source": string,"status"?: string,"step_id"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"campaign_id"?: string | null,"channel_id"?: string,"claim_token"?: string | null,"claimed_until"?: string | null,"contact_id"?: string | null,"conversation_id"?: string | null,"created_at"?: string,"enrollment_id"?: string | null,"id"?: string,"intent_id"?: string | null,"message_id"?: string | null,"organization_id"?: string,"postponements"?: number,"reason"?: string | null,"run_after"?: string,"source"?: string,"status"?: string,"step_id"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "outreach_deliveries_intent_id_fkey"
      columns: ["intent_id"]
isOneToOne: false
      referencedRelation: "instagram_send_intents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outreach_deliveries_organization_id_campaign_id_fkey"
      columns: ["organization_id","campaign_id"]
isOneToOne: false
      referencedRelation: "campaigns"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "outreach_deliveries_organization_id_channel_id_fkey"
      columns: ["organization_id","channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "outreach_deliveries_organization_id_contact_id_fkey"
      columns: ["organization_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "outreach_deliveries_organization_id_conversation_id_fkey"
      columns: ["organization_id","conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "outreach_deliveries_organization_id_enrollment_id_fkey"
      columns: ["organization_id","enrollment_id"]
isOneToOne: false
      referencedRelation: "sequence_enrollments"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "outreach_deliveries_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "outreach_deliveries_organization_id_message_id_fkey"
      columns: ["organization_id","message_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "outreach_deliveries_organization_id_step_id_fkey"
      columns: ["organization_id","step_id"]
isOneToOne: false
      referencedRelation: "sequence_steps"
      referencedColumns: ["organization_id","id"]
    }
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
                },"sequence_enrollments": {
                  Row: {
                    "channel_id": string,"contact_id": string,"created_at": string,"current_position": number,"exit_reason": string | null,"id": string,"next_send_at": string | null,"organization_id": string,"sequence_id": string,"status": string
                  }
                  ComputedFields: never
                  Insert: {
                    "channel_id": string,"contact_id": string,"created_at"?: string,"current_position"?: number,"exit_reason"?: string | null,"id"?: string,"next_send_at"?: string | null,"organization_id": string,"sequence_id": string,"status"?: string
                  }
                  Update: {
                    "channel_id"?: string,"contact_id"?: string,"created_at"?: string,"current_position"?: number,"exit_reason"?: string | null,"id"?: string,"next_send_at"?: string | null,"organization_id"?: string,"sequence_id"?: string,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sequence_enrollments_organization_id_channel_id_fkey"
      columns: ["organization_id","channel_id"]
isOneToOne: false
      referencedRelation: "channels"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "sequence_enrollments_organization_id_contact_id_fkey"
      columns: ["organization_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["organization_id","id"]
    },{
      foreignKeyName: "sequence_enrollments_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sequence_enrollments_organization_id_sequence_id_fkey"
      columns: ["organization_id","sequence_id"]
isOneToOne: false
      referencedRelation: "sequences"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"sequence_steps": {
                  Row: {
                    "created_at": string,"delay_minutes": number,"id": string,"message": NonNullable<Json>,"organization_id": string,"position": number | null,"removed_at": string | null,"sequence_id": string,"window": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"delay_minutes": number,"id"?: string,"message": NonNullable<Json>,"organization_id": string,"position"?: number | null,"removed_at"?: string | null,"sequence_id": string,"window"?: Json | null
                  }
                  Update: {
                    "created_at"?: string,"delay_minutes"?: number,"id"?: string,"message"?: NonNullable<Json>,"organization_id"?: string,"position"?: number | null,"removed_at"?: string | null,"sequence_id"?: string,"window"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sequence_steps_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "sequence_steps_organization_id_sequence_id_fkey"
      columns: ["organization_id","sequence_id"]
isOneToOne: false
      referencedRelation: "sequences"
      referencedColumns: ["organization_id","id"]
    }
                  ]
                },"sequences": {
                  Row: {
                    "created_at": string,"id": string,"name": string,"organization_id": string,"settings": NonNullable<Json>,"status": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"name": string,"organization_id": string,"settings"?: NonNullable<Json>,"status"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"name"?: string,"organization_id"?: string,"settings"?: NonNullable<Json>,"status"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "sequences_organization_id_fkey"
      columns: ["organization_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
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
            "activate_automation":
{ Args: { "p_id": string }; Returns: number
                           },
"ai_quota":
{ Args: { "p_org": string }; Returns: Json
                           },
"apply_automation_step":
{ Args: { "p_run": string,"p_step": Json,"p_token": string }; Returns: Json
                           },
"archive_entry_link":
{ Args: { "p_id": string }; Returns: undefined
                           },
"automation_button_payloads":
{ Args: { "p_node_id": string,"p_run": string,"p_token": string }; Returns: Json
                           },
"automation_run_counts":
{ Args: { "p_org": string,"p_since": string }; Returns: {
              "automation_id": string,"runs": number
            }[]
                           },
"check_auth_rate_limit":
{ Args: { "p_kind": string,"p_limit": number,"p_subject": string,"p_window_seconds": number }; Returns: boolean
                           },
"check_rate_limit":
{ Args: { "p_key": string,"p_limit": number,"p_window_seconds": number }; Returns: boolean
                           },
"claim_ai_jobs":
{ Args: { "p_limit": number }; Returns: Json
                           },
"claim_automation_runs":
{ Args: { "p_limit": number }; Returns: Json
                           },
"claim_instagram_send":
{ Args: { "p_intent_id": string }; Returns: Json
                           },
"cleanup_instagram_events":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"click_automation_button":
{ Args: { "p_message_id": string,"p_option_id": string }; Returns: string
                           },
"complete_ai_reply":
{ Args: { "p_job": string,"p_result": Json,"p_token": string }; Returns: Json
                           },
"complete_index_document":
{ Args: { "p_chunks": Json,"p_job": string,"p_token": string }; Returns: string
                           },
"complete_instagram_send":
{ Args: { "p_intent_id": string,"p_result": Json }; Returns: undefined
                           },
"configure_ai_worker":
{ Args: { "p_base_url": string,"p_service_key": string,"p_worker_secret": string }; Returns: undefined
                           },
"configure_automation_worker":
{ Args: { "p_base_url": string,"p_service_key": string,"p_worker_secret": string }; Returns: undefined
                           },
"configure_instagram_worker":
{ Args: { "p_base_url": string,"p_service_key": string,"p_worker_secret": string }; Returns: undefined
                           },
"consume_ai_quota":
{ Args: { "p_kind": string,"p_org": string }; Returns: boolean
                           },
"create_instagram_send_intent":
{ Args: { "p_conversation_id": string,"p_request_id": string,"p_text": string }; Returns: string
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
"delete_automation":
{ Args: { "p_id": string }; Returns: undefined
                           },
"delete_campaign":
{ Args: { "p_id": string }; Returns: undefined
                           },
"delete_sequence":
{ Args: { "p_id": string }; Returns: undefined
                           },
"delete_stage_moving_deals":
{ Args: { "p_stage": string,"p_target_stage": string }; Returns: undefined
                           },
"disconnect_instagram_connection":
{ Args: { "p_actor_id": string,"p_connection_id": string,"p_org_id": string }; Returns: undefined
                           },
"dispatch_ai_worker":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"dispatch_automation_worker":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"dispatch_instagram_worker":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"duplicate_automation":
{ Args: { "p_id": string }; Returns: string
                           },
"emit_event":
{ Args: { "p_contact_id": string,"p_conversation_id": string,"p_deal_id": string,"p_org": string,"p_payload"?: Json,"p_type": string }; Returns: undefined
                           },
"enroll_contact_in_sequence":
{ Args: { "p_contact": string,"p_sequence": string }; Returns: string
                           },
"fail_ai_job":
{ Args: { "p_error_code": string,"p_job": string,"p_retryable": boolean,"p_token": string }; Returns: undefined
                           },
"fail_automation_run":
{ Args: { "p_code": string,"p_retryable": boolean,"p_run": string,"p_token": string }; Returns: undefined
                           },
"finish_instagram_work":
{ Args: { "p_error_code": string,"p_queue_id": number,"p_state": string }; Returns: undefined
                           },
"handoff_ai_job":
{ Args: { "p_job": string,"p_reason": string,"p_token": string }; Returns: Json
                           },
"has_role":
{ Args: { "p_min": Database["public"]['Enums']["org_role"],"p_org": string }; Returns: boolean
                           },
"inbox_counts":
{ Args: { "p_org": string }; Returns: Json
                           },
"inbox_unread_count":
{ Args: { "p_org": string }; Returns: number
                           },
"ingest_inbound_message":
{ Args: { "p_channel": string,"p_external_id": string,"p_sender_external_id": string,"p_sender_name": string,"p_sent_at": string,"p_text": string }; Returns: string
                           } |
{ Args: { "p_channel": string,"p_context": Json,"p_external_id": string,"p_sender_external_id": string,"p_sender_name": string,"p_sent_at": string,"p_text": string }; Returns: string
                           },
"ingest_instagram_event":
{ Args: { "p_connection_id": string,"p_event": Json }; Returns: Json
                           },
"instagram_keyword_matches":
{ Args: { "p_keyword": string,"p_text": string }; Returns: boolean
                           },
"is_member":
{ Args: { "p_org": string }; Returns: boolean
                           },
"is_valid_timezone":
{ Args: { "p": string }; Returns: boolean
                           },
"list_inbox":
{ Args: { "p_channel": string,"p_cursor_at": string,"p_cursor_id": string,"p_limit": number,"p_org": string,"p_q": string,"p_tab": string }; Returns: {
              "assigned_to": string,"assignee_name": string,"channel_id": string,"channel_type": Database["public"]['Enums']["channel_type"],"contact_email": string,"contact_id": string,"contact_name": string,"contact_phone": string,"handled_by": Database["public"]['Enums']["handler_type"],"id": string,"last_inbound_at": string,"last_message_at": string,"last_read_at": string,"preview": string,"preview_from_team": boolean,"status": Database["public"]['Enums']["conversation_status"]
            }[]
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
"match_knowledge_chunks":
{ Args: { "p_embedding": string,"p_k"?: number,"p_min_similarity"?: number,"p_org": string }; Returns: {
              "content": string,"document_id": string,"document_title": string,"id": string,"similarity": number
            }[]
                           },
"pause_automation":
{ Args: { "p_id": string }; Returns: undefined
                           },
"prepare_ai_playground":
{ Args: { "p_org": string }; Returns: Json
                           },
"prepare_ai_reply":
{ Args: { "p_job": string,"p_token": string }; Returns: Json
                           },
"prepare_automation_run":
{ Args: { "p_run": string,"p_token": string }; Returns: Json
                           },
"prepare_index_document":
{ Args: { "p_job": string,"p_token": string }; Returns: Json
                           },
"prepare_instagram_comment_send":
{ Args: { "p_event_id": string }; Returns: Json
                           },
"prepare_instagram_profile":
{ Args: { "p_event_id": string }; Returns: Json
                           },
"read_ai_worker_config":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"read_automation_worker_config":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"read_instagram_work":
{ Args: { "p_limit": number }; Returns: Json
                           },
"read_instagram_worker_config":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"read_meta_connection_secrets":
{ Args: { "p_connection_id": string }; Returns: Json
                           },
"record_instagram_username":
{ Args: { "p_channel_id": string,"p_username": string }; Returns: undefined
                           },
"remove_contact_from_sequence":
{ Args: { "p_contact": string,"p_sequence": string }; Returns: undefined
                           },
"remove_instagram_connection":
{ Args: { "p_actor_id": string,"p_connection_id": string,"p_org_id": string }; Returns: Json
                           },
"reorder_stages":
{ Args: { "p_pipeline": string,"p_stage_ids": (string)[] }; Returns: undefined
                           },
"reprocess_knowledge_document":
{ Args: { "p_id": string }; Returns: undefined
                           },
"rerun_automation_from":
{ Args: { "p_node": string,"p_run": string }; Returns: number
                           },
"reselect_instagram_comment_rule":
{ Args: { "p_comment_at": string,"p_event_id": string }; Returns: Json
                           },
"retry_instagram_send_intent":
{ Args: { "p_message_id": string }; Returns: string
                           },
"return_to_ai":
{ Args: { "p_conversation": string }; Returns: undefined
                           },
"role_rank":
{ Args: { "r": Database["public"]['Enums']["org_role"] }; Returns: number
                           },
"save_automation":
{ Args: { "p_graph": Json,"p_id": string,"p_name": string,"p_org": string,"p_trigger_config": Json,"p_trigger_type": Database["public"]['Enums']["automation_trigger_type"] }; Returns: string
                           },
"save_campaign":
{ Args: { "p_audience": Json,"p_id": string,"p_message": Json,"p_name": string,"p_org": string }; Returns: string
                           },
"save_contact":
{ Args: { "p_contact_id": string,"p_custom_fields": Json,"p_data": Json,"p_org": string,"p_tag_ids": (string)[] }; Returns: string
                           },
"save_entry_link":
{ Args: { "p_id": string,"p_input": Json,"p_org": string }; Returns: string
                           },
"save_instagram_comment_rule":
{ Args: { "p_input": Json }; Returns: string
                           },
"save_instagram_connection":
{ Args: { "p_actor_id": string,"p_input": Json,"p_org_id": string }; Returns: Json
                           },
"save_instagram_contact_name":
{ Args: { "p_event_id": string,"p_name": string }; Returns: undefined
                           },
"save_knowledge_document":
{ Args: { "p_content": string,"p_id": string,"p_org": string,"p_title": string }; Returns: string
                           },
"save_sequence":
{ Args: { "p_id": string,"p_name": string,"p_org": string,"p_settings": Json,"p_steps": Json }; Returns: string
                           },
"search_contacts":
{ Args: { "p_assignee": string,"p_limit": number,"p_offset": number,"p_order": string,"p_org": string,"p_q": string,"p_source": Database["public"]['Enums']["contact_source"],"p_status": Database["public"]['Enums']["contact_status"],"p_tag": string }; Returns: {
              "assigned_to": string,"created_at": string,"email": string,"id": string,"last_interaction_at": string,"lead_score": number,"name": string,"phone": string,"source": Database["public"]['Enums']["contact_source"],"status": Database["public"]['Enums']["contact_status"],"tag_ids": (string)[],"total_count": number
            }[]
                           },
"set_instagram_username":
{ Args: { "p_channel": string,"p_username": string }; Returns: undefined
                           },
"set_meta_connection_verification":
{ Args: { "p_connection_id": string,"p_error_code": string,"p_generation": number,"p_kind": string,"p_success": boolean }; Returns: undefined
                           },
"set_sequence_status":
{ Args: { "p_id": string,"p_status": string }; Returns: undefined
                           },
"set_stage_outcome":
{ Args: { "p_outcome": string,"p_stage": string }; Returns: undefined
                           },
"shares_org_with":
{ Args: { "p_user": string }; Returns: boolean
                           },
"simulate_entry_link":
{ Args: { "p_contact_name": string,"p_contact_phone": string,"p_link": string }; Returns: string
                           },
"slugify":
{ Args: { "p": string }; Returns: string
                           },
"stop_automation":
{ Args: { "p_conversation": string }; Returns: undefined
                           },
"sweep_ai_jobs":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"sweep_automation_runs":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"sweep_instagram_send_intents":
{ Args: Record<PropertyKey, never>; Returns: undefined
                           },
"verify_instagram_media":
{ Args: { "p_channel_id": string,"p_connection_id": string,"p_generation": number,"p_media_id": string }; Returns: undefined
                           },
"write_audit_log":
{ Args: { "p_action": string,"p_entity_id": string,"p_entity_type": string,"p_ip"?: unknown,"p_metadata"?: Json,"p_org": string }; Returns: undefined
                           },
"yield_automation_run":
{ Args: { "p_run": string,"p_token": string }; Returns: undefined
                           }
          }
          Enums: {
            "automation_node_type": "trigger"|"condition"|"message"|"delay"|"tag"|"remove_tag"|"assign_user"|"move_stage"|"ai"|"webhook"|"close_conversation"|"end"|"handoff_ai"|"handoff_human"|"sequence_enroll"|"sequence_remove","automation_status": "draft"|"active"|"paused","automation_trigger_type": "message_received"|"keyword_detected"|"conversation_created"|"tag_added"|"stage_changed"|"contact_created"|"instagram_comment"|"instagram_story"|"entry_link","channel_status": "needs_setup"|"active"|"error","channel_type": "whatsapp"|"instagram"|"simulator","contact_source": "whatsapp"|"instagram"|"manual"|"simulator","contact_status": "lead"|"customer"|"inactive","conversation_status": "open"|"pending_human"|"closed","deal_status": "open"|"won"|"lost","handler_type": "ai"|"human","knowledge_status": "processing"|"ready"|"error","message_direction": "inbound"|"outbound","message_status": "pending"|"sent"|"delivered"|"read"|"failed","org_role": "owner"|"admin"|"agent"|"viewer","run_status": "pending"|"running"|"waiting"|"completed"|"failed"|"cancelled","sender_type": "contact"|"ai"|"human"|"system"|"automation","sentiment": "positive"|"neutral"|"negative"
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
            "automation_node_type": ["trigger", "condition", "message", "delay", "tag", "remove_tag", "assign_user", "move_stage", "ai", "webhook", "close_conversation", "end", "handoff_ai", "handoff_human", "sequence_enroll", "sequence_remove"],"automation_status": ["draft", "active", "paused"],"automation_trigger_type": ["message_received", "keyword_detected", "conversation_created", "tag_added", "stage_changed", "contact_created", "instagram_comment", "instagram_story", "entry_link"],"channel_status": ["needs_setup", "active", "error"],"channel_type": ["whatsapp", "instagram", "simulator"],"contact_source": ["whatsapp", "instagram", "manual", "simulator"],"contact_status": ["lead", "customer", "inactive"],"conversation_status": ["open", "pending_human", "closed"],"deal_status": ["open", "won", "lost"],"handler_type": ["ai", "human"],"knowledge_status": ["processing", "ready", "error"],"message_direction": ["inbound", "outbound"],"message_status": ["pending", "sent", "delivered", "read", "failed"],"org_role": ["owner", "admin", "agent", "viewer"],"run_status": ["pending", "running", "waiting", "completed", "failed", "cancelled"],"sender_type": ["contact", "ai", "human", "system", "automation"],"sentiment": ["positive", "neutral", "negative"]
          }
        }
} as const
